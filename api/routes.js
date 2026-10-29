/**
 * ============================================================================
 * ARCHIVO: api/routes.js
 * PROPÓSITO: todos los endpoints HTTP del POS y su lógica SQL.
 *
 * PATRÓN GENERAL:
 *   routes.metodo("/ruta/", (req, res) => {
 *     req.getConnection((err, conn) => {
 *       if (err) return res.send(err);
 *       conn.query("SQL con ?", [valores], (err, filas) => {
 *         if (err) { console.log(err); return res.send(err); }
 *         res.json(filas);
 *       });
 *     });
 *   });
 *
 * GRUPOS DE RUTAS (en orden dentro del archivo):
 *  1. Usuarios / Login
 *  2. Mesas
 *  3. Categorías y productos
 *  4. Facturas: crear, líneas, pagar, listar, detalle, borrar,
 *     mover/fusionar líneas entre cuentas de la misma mesa
 *  5. Métodos de pago
 *  6. Configuración del ticket (machote)
 *  7. Cliente de la factura
 *  8. Cargos por porcentaje (catálogo + aplicación por cuenta)
 *  9. Cierre de caja: pendientes, crear cierre, historial y detalle
 *
 * CONVENCIONES:
 *  - SQL siempre parametrizado con `?` (no concatenar datos del usuario).
 *  - `factura.estado`: 1 = abierta, 0 = cerrada/pagada.
 *  - `factura.cierre`: 0 = pendiente de cierre de caja, 1 = cerrada de caja.
 *  - Los cargos NO guardan monto: se calcula sobre la suma de líneas.
 *  - Varias operaciones encadenan consultas sin transacción; asumir una caja.
 *
 * CUIDADO:
 *  - `POST /factura/add/` y `POST /factura/linea/` devuelven el ID con
 *    MAX(...), no es atómico. No usar en un escenario multi-caja sin refactor.
 *  - Al agregar campos a `configuracion_ticket`, incluirlos en
 *    CAMPOS_CONFIG_TICKET o el PUT los ignorará.
 *  - `POST /factura/mover-linea/` bloquea ambas cuentas en orden de ID y
 *    valida que sean de la misma mesa, estén abiertas y no tengan partes
 *    pagadas de una división. Mueve cantidades parciales conservando el
 *    subtotal exacto y fusiona solo si coinciden producto y precio.
 *  - `POST /cierre/` es el ÚNICO endpoint que crea un cierre y marca
 *    `factura.cierre = 1`. Usa transacción y rollback si alguna factura
 *    cambió desde la vista previa. `GET /cierre/pendientes/` es solo lectura.
 *    No existe un GET que cierre caja (el antiguo /factura/cierre/ se eliminó).
 *
 * Ver DOCUMENTACION_VINEDOPOS.md (sección 6) para el catálogo completo.
 * ============================================================================
 */
const express = require("express");
const os = require("os");
const routes = express.Router();

const obtenerIpLocal = () => {
  const interfaces = os.networkInterfaces();
  for (let nombre in interfaces) {
    const lista = interfaces[nombre] || [];
    for (let i = 0; i < lista.length; i++) {
      const iface = lista[i];
      if (iface.family === "IPv4" && !iface.internal && iface.address) {
        return iface.address;
      }
    }
  }
  return "localhost";
};

routes.get("/red/ip", (req, res) => {
  const ip = obtenerIpLocal();
  res.json({
    ip: ip,
    puertoApi: 9000,
    puertoFrontend: 3000,
    urlApi: `http://${ip}:9000`,
    urlFrontend: `http://${ip}:3000`
  });
});

// ---- Utilidades de división igualitaria (Tramo 3) ----
const redondearMoneda = (valor) => Math.round((Number(valor) || 0) * 100) / 100;

// Reparte un monto en centavos exactos. El sobrante de 1 centavo se asigna
// a las primeras partes, de modo que la suma de todas sea igual al total.
const parteIgualitaria = (total, parte, partes) => {
  const totalPartes = Math.max(1, Math.floor(Number(partes) || 1));
  const numeroParte = Math.max(1, Math.min(Math.floor(Number(parte) || 1), totalPartes));
  const totalCentavos = Math.round((Number(total) || 0) * 100);
  const base = Math.floor(totalCentavos / totalPartes);
  const sobrante = totalCentavos - base * totalPartes;
  return (base + (numeroParte <= sobrante ? 1 : 0)) / 100;
};

// Total real de una cuenta: suma de líneas + cargos porcentuales.
const calcularTotalCuenta = async (consultar, facturaID) => {
  const baseRes = await consultar(
    "SELECT COALESCE(SUM(Subtotal), 0) AS Base FROM lineafactura WHERE FacturaID = ?",
    [facturaID]
  );
  const base = redondearMoneda((baseRes && baseRes[0] && baseRes[0].Base) || 0);
  const cargosRes = await consultar(
    "SELECT idCargo, nombre, porcentaje FROM factura_cargo WHERE FacturaID = ? ORDER BY idFacturaCargo",
    [facturaID]
  );
  const cargos = (cargosRes || []).map((cargo) => ({
    idCargo: cargo.idCargo,
    nombre: cargo.nombre,
    porcentaje: Number(cargo.porcentaje || 0)
  }));
  let totalCargos = 0;
  cargos.forEach((cargo) => {
    totalCargos += redondearMoneda((base * cargo.porcentaje) / 100);
  });
  return { base, cargos, total: redondearMoneda(base + totalCargos) };
};

// Pagos registrados por parte. `monto_parte` guarda la parte aplicada (no lo
// entregado), para que un pago en efectivo con vuelto no descuadre el saldo.
const leerPartesPago = async (consultar, facturaID) => {
  const filas = await consultar(
    `SELECT parte, MAX(partes) AS partes, MAX(monto_parte) AS monto
     FROM pagos_factura
     WHERE FacturaID = ? AND parte IS NOT NULL
     GROUP BY parte
     ORDER BY parte`,
    [facturaID]
  );
  const lista = filas || [];
  const partes = lista.length > 0 ? Number(lista[0].partes || 0) : 0;
  const pagadas = lista.length;
  const pagado = redondearMoneda(
    lista.reduce((acc, fila) => acc + Number(fila.monto || 0), 0)
  );
  return { filas: lista, partes, pagadas, pagado };
};

// ---- Cierre de caja (Fase 3) ----

// Une los métodos activos (aunque estén en 0) con los pagos encontrados.
const normalizarMetodosCierre = (pagos, activos) => {
  const mapa = new Map();
  (activos || []).forEach((fila) => {
    const nombre = String(fila.nombre || "").toUpperCase();
    if (!nombre) return;
    mapa.set(nombre, { metodo_pago: nombre, cantidad: 0, monto: 0 });
  });
  (pagos || []).forEach((fila) => {
    const nombre = String(fila.metodo_pago || "").toUpperCase();
    if (!nombre) return;
    const actual = mapa.get(nombre) || { metodo_pago: nombre, cantidad: 0, monto: 0 };
    actual.cantidad = Number(fila.cantidad || fila.Cantidad || 0);
    actual.monto = redondearMoneda(fila.monto || fila.Monto || 0);
    mapa.set(nombre, actual);
  });
  return Array.from(mapa.values());
};

// Calcula totales y efectivo neto a partir de las facturas incluidas.
const resumenCierreDesdeFacturas = (facturas, metodos) => {
  const lista = facturas || [];
  const total = redondearMoneda(lista.reduce((acc, f) => acc + Number(f.Total || 0), 0));
  const vuelto = redondearMoneda(
    lista.reduce((acc, f) => acc + Number(f.vuelto !== undefined ? f.vuelto : f.Vuelto || 0), 0)
  );
  const efectivo = (metodos || []).find((m) => m.metodo_pago === "EFECTIVO");
  const efectivoRecibido = redondearMoneda(efectivo ? efectivo.monto : 0);
  const fechas = lista
    .map((f) => f.fecha_cierre)
    .filter(Boolean)
    .map((fecha) => (fecha instanceof Date ? fecha.getTime() : new Date(fecha).getTime()))
    .filter((valor) => !isNaN(valor))
    .sort((a, b) => a - b);
  return {
    CantidadFacturas: lista.length,
    Total: total,
    EfectivoRecibido: efectivoRecibido,
    Vuelto: vuelto,
    EfectivoNeto: redondearMoneda(efectivoRecibido - vuelto),
    Desde: fechas.length ? new Date(fechas[0]) : null,
    Hasta: fechas.length ? new Date(fechas[fechas.length - 1]) : null
  };
};

const leerFacturasPendientesCierre = async (consultar) => {
  const filas = await consultar(
    `SELECT f.FacturaID, f.MesaID, f.NombreMesa, f.Cliente, f.Total, f.vuelto,
            f.fecha_cierre, f.usuario_cobro, u.usuario AS UsuarioCobro
     FROM factura f
     LEFT JOIN usuario u ON u.idUsuario = f.usuario_cobro
     WHERE f.estado = 0 AND f.cierre = 0
     ORDER BY f.fecha_cierre, f.FacturaID`
  );
  return (filas || []).map((f) => ({
    FacturaID: Number(f.FacturaID),
    MesaID: f.MesaID,
    NombreMesa: f.NombreMesa,
    Cliente: f.Cliente,
    Total: redondearMoneda(f.Total),
    Vuelto: redondearMoneda(f.vuelto),
    fecha_cierre: f.fecha_cierre,
    usuario_cobro: f.usuario_cobro,
    UsuarioCobro: f.UsuarioCobro || null
  }));
};

const leerMetodosCierre = async (consultar, facturaIDs) => {
  let pagos = [];
  if (facturaIDs && facturaIDs.length > 0) {
    pagos = await consultar(
      `SELECT p.metodo_pago, COUNT(*) AS cantidad, COALESCE(SUM(p.monto), 0) AS monto
       FROM pagos_factura p
       WHERE p.FacturaID IN (?)
       GROUP BY p.metodo_pago`,
      [facturaIDs]
    );
  }
  const activos = await consultar(
    "SELECT nombre FROM metodos_pago WHERE activo = 1 ORDER BY id"
  );
  return normalizarMetodosCierre(pagos, activos);
};

const leerCierreCaja = async (consultar, cierreID) => {
  const cabeceraRes = await consultar(
    `SELECT c.*, u.usuario AS Usuario
     FROM cierre_caja c
     LEFT JOIN usuario u ON u.idUsuario = c.usuario_id
     WHERE c.CierreID = ?`,
    [cierreID]
  );
  const cabecera = cabeceraRes && cabeceraRes[0];
  if (!cabecera) return null;
  const metodos = await consultar(
    `SELECT metodo_pago, cantidad, monto
     FROM cierre_caja_pago
     WHERE CierreID = ?
     ORDER BY CierrePagoID`,
    [cierreID]
  );
  const facturas = await consultar(
    `SELECT FacturaID, Total, MesaID, NombreMesa, Cliente, fecha_cierre
     FROM cierre_caja_factura
     WHERE CierreID = ?
     ORDER BY FacturaID`,
    [cierreID]
  );
  return {
    CierreID: Number(cabecera.CierreID),
    fecha: cabecera.fecha,
    usuario_id: cabecera.usuario_id,
    usuario: cabecera.Usuario || cabecera.usuario || null,
    desde: cabecera.desde,
    hasta: cabecera.hasta,
    CantidadFacturas: Number(cabecera.facturas || 0),
    Total: redondearMoneda(cabecera.total),
    EfectivoRecibido: redondearMoneda(cabecera.efectivo_recibido),
    Vuelto: redondearMoneda(cabecera.vuelto),
    EfectivoNeto: redondearMoneda(cabecera.efectivo_neto),
    EfectivoContado:
      cabecera.efectivo_contado === null ? null : redondearMoneda(cabecera.efectivo_contado),
    Diferencia:
      cabecera.diferencia === null ? null : redondearMoneda(cabecera.diferencia),
    Observaciones: cabecera.observaciones || null,
    Metodos: (metodos || []).map((m) => ({
      metodo_pago: m.metodo_pago,
      cantidad: Number(m.cantidad || 0),
      monto: redondearMoneda(m.monto)
    })),
    Facturas: (facturas || []).map((f) => ({
      FacturaID: Number(f.FacturaID),
      Total: redondearMoneda(f.Total),
      MesaID: f.MesaID,
      NombreMesa: f.NombreMesa,
      Cliente: f.Cliente,
      fecha_cierre: f.fecha_cierre
    }))
  };
};

//-------------------Usuarios

//---------LOGIN-----------------
routes.post("/Login/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "SELECT * FROM usuario WHERE usuario = ? ",
        [req.body.usuario],
        (err, usuarios) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            if (usuarios == "") {
              res.json("userName");
            } else {
              if (usuarios[0].contraseña != req.body.contraseña) {
                res.json("password");
              } else {
                res.json(usuarios[0].idUsuario);
              }
            }
          }
        }
      );
    }
  });
});

//Obtener usuarios
routes.get("/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query("SELECT * FROM usuario", (err, usuarios) => {
        if (err) {
          return res.send(err);
        } else {
          res.json(usuarios);
        }
      });
    }
  });
});

//Eliminar usuario
routes.delete("/:id", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "DELETE FROM usuario WHERE idUsuario = ?",
        [req.params.id],
        (err, usuarios) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            res.send("Eliminado el id: " + req.params.id);
          }
        }
      );
    }
  });
});
//Actualizar usuario


//---------------------MESAS--------------
//Obtener mesas
routes.get("/mesas/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    }
    conn.query("SHOW COLUMNS FROM mesa LIKE 'orden'", (errCols, cols) => {
      const tieneOrden = cols && cols.length > 0;
      if (!tieneOrden) {
        conn.query("ALTER TABLE mesa ADD COLUMN orden INT DEFAULT 0", (errAlter) => {
          if (errAlter && errAlter.code !== "ER_DUP_FIELDNAME") {
            console.log(errAlter);
          }
          conn.query("SELECT MesaID, Nombre, COALESCE(orden,0) AS orden FROM mesa ORDER BY (COALESCE(orden,0) = 0), COALESCE(orden,0), MesaID", (err2, mesas) => {
            if (err2) {
              return res.send(err2);
            } else {
              res.json(mesas);
            }
          });
        });
      } else {
        conn.query("SELECT MesaID, Nombre, COALESCE(orden,0) AS orden FROM mesa ORDER BY (COALESCE(orden,0) = 0), COALESCE(orden,0), MesaID", (err2, mesas) => {
          if (err2) {
            return res.send(err2);
          } else {
            res.json(mesas);
          }
        });
      }
    });
  });
});

//Ordenar mesas
routes.post("/mesas/ordenar", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    }
    conn.query("SHOW COLUMNS FROM mesa LIKE 'orden'", (errCols, cols) => {
      const tieneOrden = cols && cols.length > 0;
      const guardar = () => {
        const ordenes = Array.isArray(req.body.ordenes) ? req.body.ordenes : [];
        if (ordenes.length === 0) {
          return res.json({ success: true });
        }
        let pendientes = ordenes.length;
        let respondido = false;
        ordenes.forEach((item) => {
          const mesaID = Number(item.MesaID);
          const orden = Number(item.orden || 0);
          if (!mesaID) {
            pendientes--;
            if (pendientes === 0 && !respondido) {
              respondido = true;
              return res.json({ success: true });
            }
            return;
          }
          conn.query("UPDATE mesa SET orden = ? WHERE MesaID = ?", [orden, mesaID], (errUpd) => {
            if (errUpd) {
              console.log(errUpd);
            }
            pendientes--;
            if (pendientes === 0 && !respondido) {
              respondido = true;
              return res.json({ success: true });
            }
          });
        });
      };
      if (!tieneOrden) {
        conn.query("ALTER TABLE mesa ADD COLUMN orden INT DEFAULT 0", (errAlter) => {
          if (errAlter && errAlter.code !== "ER_DUP_FIELDNAME") {
            console.log(errAlter);
          }
          guardar();
        });
      } else {
        guardar();
      }
    });
  });
});

//Mesa en uso
routes.get("/mesas/use/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      //"SELECT mesa.MesaID,mesa.Nombre,factura.FacturaID,factura.Hora,factura.Fecha,factura.estado FROM mesa Left JOIN factura ON mesa.MesaID = factura.MesaID WHERE estado IS NULL OR estado = 1"
      conn.query(
        "SELECT * FROM factura WHERE estado = 1 ",
        (err, mesas) => {
          if (err) {
            return res.send(err);
          } else {
            //console.log(mesas)
            res.json(mesas)
          }
        }
      );
    }
  });
});
//Transferir cuenta a otra mesa
routes.post("/factura/transferir", (req, res) => {
  req.getConnection(async (err, conn) => {
    if (err) {
      return res.send(err);
    }
    const consultar = (sql, valores = []) =>
      new Promise((resolve, reject) => {
        conn.query(sql, valores, (error, resultado) => {
          if (error) return reject(error);
          resolve(resultado);
        });
      });
    const FacturaID = Number(req.body.FacturaID);
    const MesaID = Number(req.body.MesaID);
    const NombreMesa = (req.body.NombreMesa || "").toString().trim();
    if (!FacturaID || !MesaID || !NombreMesa) {
      return res.status(400).json({ error: "FacturaID, MesaID y NombreMesa son requeridos" });
    }
    try {
      await consultar("START TRANSACTION");
      const facturaRes = await consultar(
        "SELECT FacturaID, MesaID, NombreMesa, estado FROM factura WHERE FacturaID = ? FOR UPDATE",
        [FacturaID]
      );
      const factura = facturaRes && facturaRes[0];
      if (!factura) {
        await consultar("ROLLBACK");
        return res.status(404).json({ error: "La cuenta no existe" });
      }
      if (Number(factura.estado) !== 1) {
        await consultar("ROLLBACK");
        return res.status(400).json({ error: "Solo se pueden transferir cuentas abiertas" });
      }
      const divisionRes = await consultar(
        "SELECT COUNT(*) AS Pagadas FROM pagos_factura WHERE FacturaID = ? AND parte IS NOT NULL",
        [FacturaID]
      );
      if (divisionRes && divisionRes[0] && Number(divisionRes[0].Pagadas) > 0) {
        await consultar("ROLLBACK");
        return res.status(400).json({ error: "No se puede transferir una cuenta en división" });
      }
      const mesaRes = await consultar("SELECT MesaID, Nombre FROM mesa WHERE MesaID = ?", [MesaID]);
      if (!mesaRes || mesaRes.length === 0) {
        await consultar("ROLLBACK");
        return res.status(404).json({ error: "La mesa destino no existe" });
      }
      if (Number(factura.MesaID) === MesaID) {
        await consultar("ROLLBACK");
        return res.status(400).json({ error: "La cuenta ya está en esa mesa" });
      }
      await consultar(
        "UPDATE factura SET MesaID = ?, NombreMesa = ? WHERE FacturaID = ?",
        [MesaID, NombreMesa, FacturaID]
      );
      await consultar("COMMIT");
      res.json({ success: true, FacturaID, MesaID, NombreMesa });
    } catch (error) {
      try {
        await consultar("ROLLBACK");
      } catch (e) {}
      console.log(error);
      res.status(500).json({ error: "No se pudo transferir la cuenta" });
    }
  });
});

//Obtener linea de factura de factura previa
routes.post("/factura/previus/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err)
    } else {
      conn.query(
        `SELECT lf.LineaFacturaID, lf.ProductoID AS codigo, lf.FacturaID, lf.Cantidad, lf.Subtotal,
                COALESCE(lf.Precio, p.precio) AS Precio, p.nombre AS Nombre
         FROM lineafactura lf
         JOIN producto p ON lf.ProductoID = p.codigo
         WHERE lf.FacturaID = ?
         ORDER BY lf.LineaFacturaID`,
        [req.body.FacturaID],
        (err, lineas) => {
          if (err) {
            return res.send(err)
          } else {
            res.json(lineas)
          }
        }
      )
    }
  })
})
//Añadir mesa
routes.post("/mesas/add/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "INSERT INTO mesa(Nombre) VALUES(?)",
        [req.body.mesa],
        (err, mesa) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            res.json("Mesa registrada!!");
          }
        }
      );
    }
  });
});
//Eliminar mesas
routes.post("/mesas/delete/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      // Una mesa con cuentas abiertas no se puede eliminar
      conn.query(
        "SELECT COUNT(*) AS abiertas FROM factura WHERE MesaID = ? AND estado = 1",
        [req.body.MesaID],
        (err, filas) => {
          if (err) {
            console.log(err);
            return res.send(err);
          }
          const abiertas = Number((filas && filas[0] && filas[0].abiertas) || 0);
          if (abiertas > 0) {
            return res.status(409).json({
              error: "No se puede eliminar la mesa: tiene " + abiertas + " cuenta(s) abierta(s). Cobre o elimine esas cuentas primero."
            });
          }
          conn.query(
            "Update factura  SET MesaID=null WHERE MesaID = ?",
            [req.body.MesaID],
            (err, mesa) => {
              if (err) {
                console.log(err);
                return res.send(err);
              } else {
                conn.query(
                  "DELETE FROM mesa WHERE MesaID = ?",[req.body.MesaID],
                  (err, del) => {
                    if (err) {
                      console.log(err);
                      return res.send(err);
                    } else {
                      res.json("Mesa eliminada")
                    }
                  }
                );
              }
            }
          );
        }
      );
    }
  });
});
//---------Categorias-----------
//Obtener categorias
routes.get("/categorias/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query("SELECT * FROM categoria", (err, categorias) => {
        if (err) {
          return res.send(err);
        } else {
          res.json(categorias);
        }
      });
    }
  });
});

//---------Productos-----------
//Obtener productos
routes.post("/productos/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "SELECT * FROM producto WHERE idCategoria = ? ",
        [req.body.categoriaID],
        (err, productos) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            res.json(productos);
          }
        }
      );
    }
  });
});
//---------Factura-----------
//Añadir factura
routes.post("/factura/add/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      const cliente = (req.body.Cliente || "").toString().trim();
      conn.query(
        "INSERT INTO factura(MesaID,Hora,Fecha,estado,cierre,NombreMesa,Cliente) values(?,CURTIME(),CURDATE(),1,0,?,?);",
        [req.body.MesaID, req.body.NombreMesa, cliente === "" ? null : cliente],
        (err, facturas) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            conn.query(
              "SELECT MAX(FacturaID) AS ID from factura",
              (err, factura) => {
                if (err) {
                  console.log(err);
                  return res.send(err);
                } else {
                  res.json(factura);
                }
              }
            );
          }
        }
      );
    }
  });
});

//Cuentas abiertas de una mesa con totales calculados (base + cargos)
routes.get("/factura/cuentas/:mesaID", (req, res) => {
  req.getConnection(async (err, conn) => {
    if (err) {
      return res.send(err);
    }
    const consultar = (sql, valores = []) =>
      new Promise((resolve, reject) => {
        conn.query(sql, valores, (error, resultado) => {
          if (error) return reject(error);
          resolve(resultado);
        });
      });
    try {
      const mesaID = req.params.mesaID;
      const cuentas = await consultar(
        `SELECT f.FacturaID, f.MesaID, f.Cliente, f.NombreMesa, f.estado,
                DATE_FORMAT(f.Fecha, '%d/%m/%Y') AS Fecha,
                TIME_FORMAT(f.Hora, '%h:%i %p') AS Hora
         FROM factura f
         WHERE f.MesaID = ? AND f.estado = 1
         ORDER BY f.FacturaID`,
        [mesaID]
      );
      const lista = cuentas || [];
      if (lista.length === 0) {
        return res.json([]);
      }
      const ids = lista.map((cuenta) => cuenta.FacturaID);
      const resumen = await consultar(
        `SELECT FacturaID, COUNT(*) AS Lineas, COALESCE(SUM(Subtotal), 0) AS Base
         FROM lineafactura
         WHERE FacturaID IN (?)
         GROUP BY FacturaID`,
        [ids]
      );
      const cargos = await consultar(
        "SELECT FacturaID, idCargo, nombre, porcentaje FROM factura_cargo WHERE FacturaID IN (?)",
        [ids]
      );
      const partes = await consultar(
        `SELECT p.FacturaID, MAX(p.partes) AS Partes, COUNT(*) AS PartesPagadas,
                COALESCE(SUM(p.monto), 0) AS Pagado
         FROM (
           SELECT FacturaID, parte, MAX(partes) AS partes, MAX(monto_parte) AS monto
           FROM pagos_factura
           WHERE FacturaID IN (?) AND parte IS NOT NULL
           GROUP BY FacturaID, parte
         ) p
         GROUP BY p.FacturaID`,
        [ids]
      );
      const resumenPorFactura = {};
      (resumen || []).forEach((fila) => {
        resumenPorFactura[fila.FacturaID] = {
          Base: Number(fila.Base || 0),
          Lineas: Number(fila.Lineas || 0)
        };
      });
      const cargosPorFactura = {};
      (cargos || []).forEach((cargo) => {
        if (!cargosPorFactura[cargo.FacturaID]) {
          cargosPorFactura[cargo.FacturaID] = [];
        }
        cargosPorFactura[cargo.FacturaID].push(cargo);
      });
      const partesPorFactura = {};
      (partes || []).forEach((fila) => {
        partesPorFactura[fila.FacturaID] = {
          Partes: Number(fila.Partes || 0),
          PartesPagadas: Number(fila.PartesPagadas || 0),
          Pagado: redondearMoneda(fila.Pagado || 0)
        };
      });
      const resultado = lista.map((cuenta) => {
        const resumenCuenta = resumenPorFactura[cuenta.FacturaID] || { Base: 0, Lineas: 0 };
        const cargosCuenta = cargosPorFactura[cuenta.FacturaID] || [];
        let cargosTotal = 0;
        cargosCuenta.forEach((cargo) => {
          cargosTotal += Math.round(resumenCuenta.Base * Number(cargo.porcentaje || 0)) / 100;
        });
        cargosTotal = redondearMoneda(cargosTotal);
        const totalCuenta = redondearMoneda(resumenCuenta.Base + cargosTotal);
        const division = partesPorFactura[cuenta.FacturaID] || {
          Partes: 0,
          PartesPagadas: 0,
          Pagado: 0
        };
        return {
          ...cuenta,
          Base: redondearMoneda(resumenCuenta.Base),
          Cargos: cargosTotal,
          Total: totalCuenta,
          Lineas: resumenCuenta.Lineas,
          Partes: division.Partes,
          PartesPagadas: division.PartesPagadas,
          Pagado: division.Pagado,
          Restante: Math.max(0, redondearMoneda(totalCuenta - division.Pagado))
        };
      });
      res.json(resultado);
    } catch (error) {
      console.log(error);
      res.send(error);
    }
  });
});
//Pagar factura con uno o varios metodos de pago
routes.post("/factura/pagar/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    }
    const { FacturaID, pagos = [], usuario_id = null, vuelto = 0, Total } = req.body
    if (!FacturaID || pagos.length === 0) {
      return res.status(400).json({ error: "FacturaID y pagos son requeridos" })
    }
    let totalPagado = 0
    pagos.forEach(p => {
      totalPagado += parseFloat(p.monto || 0)
    })
    const totalFactura = parseFloat(Total || 0)
    if (totalPagado < totalFactura - 0.01) {
      return res.status(400).json({ error: "El monto pagado es menor al total" })
    }
    conn.query(
      "SELECT COUNT(*) AS Pagadas FROM pagos_factura WHERE FacturaID = ? AND parte IS NOT NULL",
      [FacturaID],
      (errDiv, divisionRes) => {
        if (errDiv) {
          console.log(errDiv)
          return res.send(errDiv)
        }
        if (divisionRes && divisionRes[0] && Number(divisionRes[0].Pagadas) > 0) {
          return res.status(400).json({
            error: "La cuenta está en división. Continúe cobrando las partes pendientes."
          })
        }
        conn.query(
          "UPDATE factura SET estado=0, fecha_cierre=NOW(), usuario_cobro=?, vuelto=?, Total=? WHERE FacturaID=?",
          [usuario_id, vuelto || (totalPagado - totalFactura), totalFactura, FacturaID],
          (errUpd) => {
            if (errUpd) {
              console.log(errUpd)
              return res.send(errUpd)
            }
            let completados = 0
            let responded = false
            pagos.forEach((pago) => {
              conn.query(
                "INSERT INTO pagos_factura(FacturaID, metodo_pago, monto, usuario_id, referencia) VALUES(?,?,?,?,?)",
                [FacturaID, pago.metodo_pago || "EFECTIVO", parseFloat(pago.monto || 0), usuario_id, pago.referencia || null],
                (errPago) => {
                  if (errPago) {
                    console.log(errPago)
                    if (!responded) {
                      responded = true
                      return res.send(errPago)
                    }
                    return
                  }
                  completados++
                  if (completados === pagos.length && !responded) {
                    responded = true
                    res.json({ success: true, FacturaID })
                  }
                }
              )
            })
          }
        )
      }
    )
  })
})

//Cobrar solo una parte de los items de una cuenta y dejar el resto abierto
routes.post("/factura/cobrar-items/", (req, res) => {
  req.getConnection(async (err, conn) => {
    if (err) {
      return res.send(err);
    }
    const consultar = (sql, valores = []) =>
      new Promise((resolve, reject) => {
        conn.query(sql, valores, (error, resultado) => {
          if (error) return reject(error);
          resolve(resultado);
        });
      });
    const redondear = (valor) => Math.round((Number(valor) || 0) * 100) / 100;
    const validacion = (mensaje) => {
      const error = new Error(mensaje);
      error.status = 400;
      return error;
    };
    const FacturaID = Number(req.body.FacturaID);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const pagos = Array.isArray(req.body.pagos) ? req.body.pagos : [];
    const usuarioID = req.body.usuario_id || null;
    if (!FacturaID || items.length === 0) {
      return res.status(400).json({ error: "FacturaID y al menos un item son requeridos" });
    }
    let enTransaccion = false;
    try {
      await consultar("START TRANSACTION");
      enTransaccion = true;
      const origenRes = await consultar(
        "SELECT * FROM factura WHERE FacturaID = ? AND estado = 1 FOR UPDATE",
        [FacturaID]
      );
      const origen = origenRes && origenRes[0];
      if (!origen) {
        throw validacion("La cuenta ya no está abierta. Actualice la mesa.");
      }
      const divisionRes = await consultar(
        "SELECT COUNT(*) AS Pagadas FROM pagos_factura WHERE FacturaID = ? AND parte IS NOT NULL",
        [FacturaID]
      );
      if (divisionRes && divisionRes[0] && Number(divisionRes[0].Pagadas) > 0) {
        throw validacion("La cuenta está en división. Termine de cobrar las partes pendientes.");
      }

      const solicitados = {};
      items.forEach((item) => {
        const idLinea = Number(item.LineaFacturaID);
        const cantidad = Math.floor(Number(item.Cantidad));
        if (!idLinea || !cantidad || cantidad <= 0) return;
        solicitados[idLinea] = (solicitados[idLinea] || 0) + cantidad;
      });
      const idsLineas = Object.keys(solicitados).map(Number);
      if (idsLineas.length === 0) {
        throw validacion("Seleccione al menos un producto con cantidad mayor a cero.");
      }

      const lineasDB = await consultar(
        `SELECT lf.LineaFacturaID, lf.ProductoID, lf.Cantidad, lf.Precio, lf.Subtotal,
                p.nombre AS Nombre, COALESCE(lf.Precio, p.precio) AS PrecioUnitario
         FROM lineafactura lf
         JOIN producto p ON p.codigo = lf.ProductoID
         WHERE lf.FacturaID = ? AND lf.LineaFacturaID IN (?)
         FOR UPDATE`,
        [FacturaID, idsLineas]
      );
      if (!lineasDB || lineasDB.length !== idsLineas.length) {
        throw validacion("Una de las líneas seleccionadas ya no existe en la cuenta.");
      }

      let baseCobrar = 0;
      const seleccionadas = lineasDB.map((linea) => {
        const cantidadCobrar = solicitados[linea.LineaFacturaID];
        if (cantidadCobrar > Number(linea.Cantidad || 0)) {
          throw validacion(
            "La cantidad de " + (linea.Nombre || "un producto") + " cambió. Actualice e intente de nuevo."
          );
        }
        const precioUnitario = redondear(linea.PrecioUnitario);
        const subtotalCobrar = redondear(precioUnitario * cantidadCobrar);
        baseCobrar = redondear(baseCobrar + subtotalCobrar);
        return {
          ...linea,
          CantidadCobrar: cantidadCobrar,
          PrecioUnitario: precioUnitario,
          SubtotalCobrar: subtotalCobrar
        };
      });

      const cargosDB = await consultar(
        "SELECT idCargo, nombre, porcentaje FROM factura_cargo WHERE FacturaID = ? ORDER BY idFacturaCargo",
        [FacturaID]
      );
      const cargosCobrar = (cargosDB || []).map((cargo) => ({
        idCargo: cargo.idCargo,
        nombre: cargo.nombre,
        porcentaje: Number(cargo.porcentaje || 0),
        monto: redondear(baseCobrar * Number(cargo.porcentaje || 0) / 100)
      }));
      const totalCargos = cargosCobrar.reduce((acc, cargo) => acc + Number(cargo.monto || 0), 0);
      const totalCobrar = redondear(baseCobrar + totalCargos);

      const pagosLimpios = pagos
        .map((pago) => ({
          metodo_pago: (pago.metodo_pago || "EFECTIVO").toString(),
          monto: redondear(pago.monto),
          referencia: pago.referencia ? pago.referencia.toString().slice(0, 100) : null
        }))
        .filter((pago) => pago.monto > 0);
      if (pagosLimpios.length === 0 && totalCobrar > 0) {
        throw validacion("Debe registrar al menos un pago.");
      }
      const totalPagado = pagosLimpios.reduce((acc, pago) => acc + Number(pago.monto || 0), 0);
      if (totalPagado < totalCobrar - 0.01) {
        throw validacion("El monto pagado es menor al total de los ítems seleccionados.");
      }
      const efectivo = pagosLimpios
        .filter((pago) => String(pago.metodo_pago).toUpperCase() === "EFECTIVO")
        .reduce((acc, pago) => acc + Number(pago.monto || 0), 0);
      const vuelto = Math.max(0, redondear(efectivo - totalCobrar));

      // Factura parcial ya pagada: conserva mesa, cliente y cargos de la cuenta origen
      const usuarioCobroFinal = (typeof usuarioID === 'object' && usuarioID !== null) ? (usuarioID.idUsuario || usuarioID.usuario_id || usuarioID.id || null) : usuarioID;
      const nuevaRes = await consultar(
        `INSERT INTO factura(MesaID,Hora,Fecha,estado,cierre,NombreMesa,Cliente,Total,fecha_cierre,usuario_cobro,vuelto)
         VALUES(?,CURTIME(),CURDATE(),0,0,?,?,?,NOW(),?,?)`,
        [origen.MesaID, origen.NombreMesa, origen.Cliente, totalCobrar, usuarioCobroFinal, vuelto]
      );
      const nuevaFacturaID = nuevaRes.insertId;

      for (const linea of seleccionadas) {
        await consultar(
          "INSERT INTO lineafactura(ProductoID,FacturaID,Cantidad,Precio,Subtotal) VALUES(?,?,?,?,?)",
          [linea.ProductoID, nuevaFacturaID, linea.CantidadCobrar, linea.PrecioUnitario, linea.SubtotalCobrar]
        );
      }
      for (const pago of pagosLimpios) {
        await consultar(
          "INSERT INTO pagos_factura(FacturaID,metodo_pago,monto,usuario_id,referencia) VALUES(?,?,?,?,?)",
          [nuevaFacturaID, pago.metodo_pago, pago.monto, usuarioCobroFinal, pago.referencia]
        );
      }

      // Descontar de la cuenta origen solo lo que se cobró
      for (const linea of seleccionadas) {
        const cantidadRestante = Number(linea.Cantidad || 0) - linea.CantidadCobrar;
        if (cantidadRestante <= 0) {
          await consultar(
            "DELETE FROM lineafactura WHERE LineaFacturaID = ? AND FacturaID = ?",
            [linea.LineaFacturaID, FacturaID]
          );
        } else {
          await consultar(
            "UPDATE lineafactura SET Cantidad = ?, Subtotal = ? WHERE LineaFacturaID = ? AND FacturaID = ?",
            [cantidadRestante, redondear(linea.PrecioUnitario * cantidadRestante), linea.LineaFacturaID, FacturaID]
          );
        }
      }

      const restantesRes = await consultar(
        "SELECT COUNT(*) AS Lineas, COALESCE(SUM(Subtotal), 0) AS Base FROM lineafactura WHERE FacturaID = ?",
        [FacturaID]
      );
      const restantes = (restantesRes && restantesRes[0]) || { Lineas: 0, Base: 0 };
      const origenQuedaAbierta = Number(restantes.Lineas) > 0;
      const baseRestante = redondear(restantes.Base);
      const cargosRestantes = cargosCobrar.reduce(
        (acc, cargo) => acc + redondear(baseRestante * Number(cargo.porcentaje || 0) / 100),
        0
      );
      const totalRestante = redondear(baseRestante + cargosRestantes);
      if (origenQuedaAbierta) {
        await consultar("UPDATE factura SET Total = ? WHERE FacturaID = ?", [totalRestante, FacturaID]);
      }

      await consultar("COMMIT");
      enTransaccion = false;

      // Los cargos son MyISAM: fuera de transacción para evitar GTID
      try {
        for (const cargo of cargosCobrar) {
          await consultar(
            "INSERT INTO factura_cargo(FacturaID,idCargo,nombre,porcentaje) VALUES(?,?,?,?)",
            [nuevaFacturaID, cargo.idCargo || null, cargo.nombre, cargo.porcentaje]
          );
        }
        if (!origenQuedaAbierta) {
          await consultar("DELETE FROM factura_cargo WHERE FacturaID = ?", [FacturaID]);
          await consultar("DELETE FROM factura WHERE FacturaID = ? AND estado = 1", [FacturaID]);
        }
      } catch (e) {
        console.log("Error al actualizar factura_cargo tras COMMIT:", e.code || e.message);
      }

      const cabeceraRes = await consultar(
        `SELECT f.FacturaID, f.Total, f.estado, f.cierre, f.vuelto, f.MesaID, f.Cliente,
                DATE_FORMAT(f.Fecha, '%d/%m/%Y') AS Fecha,
                TIME_FORMAT(f.Hora, '%h:%i %p') AS Hora,
                DATE_FORMAT(f.fecha_cierre, '%d/%m/%Y %h:%i %p') AS fecha_cierre,
                m.Nombre AS MesaNombre,
                u.usuario AS UsuarioCobro
         FROM factura f
         LEFT JOIN mesa m ON m.MesaID = f.MesaID
         LEFT JOIN usuario u ON u.idUsuario = f.usuario_cobro
         WHERE f.FacturaID = ?`,
        [nuevaFacturaID]
      );
      const cabecera = (cabeceraRes && cabeceraRes[0]) || {
        FacturaID: nuevaFacturaID,
        Total: totalCobrar,
        estado: 0,
        Cliente: origen.Cliente,
        MesaNombre: origen.NombreMesa,
        vuelto
      };
      res.json({
        success: true,
        FacturaID: nuevaFacturaID,
        detalle: {
          cabecera,
          lineas: seleccionadas.map((linea) => ({
            LineaFacturaID: null,
            FacturaID: nuevaFacturaID,
            codigo: linea.ProductoID,
            Nombre: linea.Nombre,
            Cantidad: linea.CantidadCobrar,
            Precio: linea.PrecioUnitario,
            Subtotal: linea.SubtotalCobrar
          })),
          cargos: cargosCobrar,
          pagos: pagosLimpios.map((pago) => ({ ...pago }))
        },
        origen: {
          FacturaID,
          quedaAbierta: origenQuedaAbierta,
          lineasRestantes: Number(restantes.Lineas || 0),
          baseRestante,
          totalRestante
        }
      });
    } catch (error) {
      if (enTransaccion) {
        try {
          await consultar("ROLLBACK");
        } catch (rollbackError) {
          console.log(rollbackError);
        }
      }
      console.log(error);
      return res.status(error.status || 500).json({
        error: error.status ? error.message : "No se pudo cobrar la selección de ítems."
      });
    }
  });
});

//Estado de la división igualitaria de una cuenta (Tramo 3)
routes.get("/factura/partes/:id", (req, res) => {
  req.getConnection(async (err, conn) => {
    if (err) {
      return res.send(err);
    }
    const consultar = (sql, valores = []) =>
      new Promise((resolve, reject) => {
        conn.query(sql, valores, (error, resultado) => {
          if (error) return reject(error);
          resolve(resultado);
        });
      });
    try {
      const facturaID = Number(req.params.id);
      if (!facturaID) {
        return res.status(400).json({ error: "FacturaID requerido" });
      }
      const facturaRes = await consultar(
        "SELECT FacturaID, estado FROM factura WHERE FacturaID = ?",
        [facturaID]
      );
      const factura = facturaRes && facturaRes[0];
      if (!factura) {
        return res.status(404).json({ error: "La cuenta no existe." });
      }
      const totalInfo = await calcularTotalCuenta(consultar, facturaID);
      const division = await leerPartesPago(consultar, facturaID);
      const restante = Math.max(0, redondearMoneda(totalInfo.total - division.pagado));
      const restantes = Math.max(0, division.partes - division.pagadas);
      const siguienteParte = restantes > 0 ? division.pagadas + 1 : null;
      const siguienteMonto = restantes > 0 ? parteIgualitaria(restante, 1, restantes) : 0;
      res.json({
        FacturaID: facturaID,
        estado: Number(factura.estado || 0),
        cerrada: Number(factura.estado) === 0,
        total: totalInfo.total,
        base: totalInfo.base,
        cargos: totalInfo.cargos,
        partes: division.partes,
        partesPagadas: division.pagadas,
        pagado: division.pagado,
        restante,
        restantes,
        siguienteParte,
        siguienteMonto
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({ error: "No se pudo consultar la división de la cuenta." });
    }
  });
});

//Cobrar una parte de una cuenta dividida en partes iguales (Tramo 3)
routes.post("/factura/pagar-parte/", (req, res) => {
  req.getConnection(async (err, conn) => {
    if (err) {
      return res.send(err);
    }
    const consultar = (sql, valores = []) =>
      new Promise((resolve, reject) => {
        conn.query(sql, valores, (error, resultado) => {
          if (error) return reject(error);
          resolve(resultado);
        });
      });
    const validacion = (mensaje) => {
      const error = new Error(mensaje);
      error.status = 400;
      return error;
    };
    const FacturaID = Number(req.body.FacturaID);
    const parteSolicitada = Math.floor(Number(req.body.parte));
    const partesSolicitadas = Math.floor(Number(req.body.partes));
    const pagos = Array.isArray(req.body.pagos) ? req.body.pagos : [];
    const usuarioID = req.body.usuario_id || null;
    if (!FacturaID || !parteSolicitada || !partesSolicitadas) {
      return res.status(400).json({ error: "FacturaID, parte y partes son requeridos." });
    }
    if (partesSolicitadas < 2 || partesSolicitadas > 4) {
      return res.status(400).json({ error: "La división debe ser entre 2 y 4 partes." });
    }
    if (parteSolicitada < 1 || parteSolicitada > partesSolicitadas) {
      return res.status(400).json({ error: "Número de parte inválido." });
    }
    const pagosLimpios = pagos
      .map((pago) => ({
        metodo_pago: (pago.metodo_pago || "EFECTIVO").toString(),
        monto: redondearMoneda(pago.monto),
        referencia: pago.referencia ? pago.referencia.toString().slice(0, 100) : null
      }))
      .filter((pago) => pago.monto > 0);
    if (pagosLimpios.length === 0) {
      return res.status(400).json({ error: "Debe registrar al menos un pago." });
    }
    let enTransaccion = false;
    try {
      await consultar("START TRANSACTION");
      enTransaccion = true;
      const facturaRes = await consultar(
        "SELECT FacturaID, estado FROM factura WHERE FacturaID = ? FOR UPDATE",
        [FacturaID]
      );
      const factura = facturaRes && facturaRes[0];
      if (!factura) {
        throw validacion("La cuenta no existe.");
      }
      if (Number(factura.estado) !== 1) {
        throw validacion("La cuenta ya está cerrada.");
      }
      const totalInfo = await calcularTotalCuenta(consultar, FacturaID);
      if (totalInfo.total <= 0) {
        throw validacion("La cuenta no tiene productos para dividir.");
      }
      const division = await leerPartesPago(consultar, FacturaID);
      if (division.partes > 0 && division.partes !== partesSolicitadas) {
        throw validacion("La cuenta ya está dividida en " + division.partes + " partes.");
      }
      if (division.partes === 0 && parteSolicitada !== 1) {
        throw validacion("La división debe comenzar por la parte 1.");
      }
      if (division.pagadas > 0) {
        for (let i = 0; i < division.filas.length; i++) {
          if (Number(division.filas[i].parte) !== i + 1) {
            throw validacion("La división tiene partes inconsistentes. Revise los pagos de la cuenta.");
          }
        }
      }
      if (parteSolicitada !== division.pagadas + 1) {
        throw validacion(
          "Corresponde cobrar la parte " + (division.pagadas + 1) + " de " + partesSolicitadas + "."
        );
      }
      const restante = redondearMoneda(totalInfo.total - division.pagado);
      if (restante <= 0) {
        throw validacion("La cuenta no tiene saldo pendiente por dividir.");
      }
      const restantes = Math.max(1, partesSolicitadas - division.pagadas);
      const montoParte = parteIgualitaria(restante, 1, restantes);
      const totalPagado = pagosLimpios.reduce((acc, pago) => acc + Number(pago.monto || 0), 0);
      if (totalPagado < montoParte - 0.01) {
        throw validacion(
          "El monto pagado es menor a la parte " + parteSolicitada + " (₡ " + montoParte + ")."
        );
      }
      const efectivoParte = pagosLimpios
        .filter((pago) => String(pago.metodo_pago).toUpperCase() === "EFECTIVO")
        .reduce((acc, pago) => acc + Number(pago.monto || 0), 0);
      const vueltoParte = Math.max(0, redondearMoneda(efectivoParte - montoParte));

      for (const pago of pagosLimpios) {
        await consultar(
          `INSERT INTO pagos_factura(FacturaID, metodo_pago, monto, usuario_id, referencia, parte, partes, monto_parte)
           VALUES(?,?,?,?,?,?,?,?)`,
          [
            FacturaID,
            pago.metodo_pago,
            pago.monto,
            usuarioID,
            pago.referencia,
            parteSolicitada,
            partesSolicitadas,
            montoParte
          ]
        );
      }

      const pagadas = division.pagadas + 1;
      const restantesNuevas = partesSolicitadas - pagadas;
      const restanteNuevo = redondearMoneda(restante - montoParte);
      const cerrada = restantesNuevas === 0;
      let vueltoTotal = 0;
      if (cerrada) {
        // Vuelto real entregado: por cada parte, el efectivo que excedió el
        // monto aplicado de esa parte. Así los pagos mixtos no lo distorsionan.
        const vueltoRes = await consultar(
          `SELECT COALESCE(SUM(GREATEST(0, efectivo - monto_parte)), 0) AS Vuelto
           FROM (
             SELECT parte,
                    SUM(CASE WHEN UPPER(metodo_pago) = 'EFECTIVO' THEN monto ELSE 0 END) AS efectivo,
                    MAX(monto_parte) AS monto_parte
             FROM pagos_factura
             WHERE FacturaID = ? AND parte IS NOT NULL
             GROUP BY parte
           ) t`,
          [FacturaID]
        );
        vueltoTotal = redondearMoneda((vueltoRes[0] || {}).Vuelto || 0);
        await consultar(
          "UPDATE factura SET estado = 0, fecha_cierre = NOW(), usuario_cobro = ?, Total = ?, vuelto = ? WHERE FacturaID = ?",
          [usuarioID, totalInfo.total, vueltoTotal, FacturaID]
        );
      } else {
        await consultar("UPDATE factura SET Total = ? WHERE FacturaID = ?", [totalInfo.total, FacturaID]);
      }

      await consultar("COMMIT");
      enTransaccion = false;
      res.json({
        success: true,
        FacturaID,
        parte: parteSolicitada,
        partes: partesSolicitadas,
        montoParte,
        pagadas,
        restantes: restantesNuevas,
        pagado: redondearMoneda(division.pagado + montoParte),
        restante: restanteNuevo,
        total: totalInfo.total,
        vueltoParte,
        vueltoTotal,
        cerrada,
        siguienteParte: cerrada ? null : pagadas + 1,
        siguienteMonto: cerrada ? 0 : parteIgualitaria(restanteNuevo, 1, restantesNuevas),
        pagos: pagosLimpios
      });
    } catch (error) {
      if (enTransaccion) {
        try {
          await consultar("ROLLBACK");
        } catch (rollbackError) {
          console.log(rollbackError);
        }
      }
      console.log(error);
      return res.status(error.status || 500).json({
        error: error.status ? error.message : "No se pudo cobrar la parte de la cuenta."
      });
    }
  });
});

//Obtener pagos de una factura
routes.get("/factura/pagos/:id", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err)
    }
    conn.query("SELECT * FROM pagos_factura WHERE FacturaID = ?", [req.params.id], (err, pagos) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json(pagos)
    })
  })
})

//Metodos de pago
routes.get("/metodos-pago/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err)
    }
    conn.query("SELECT * FROM metodos_pago WHERE activo = 1 ORDER BY id", (err, metodos) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json(metodos)
    })
  })
})

routes.get("/metodos-pago/all", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err)
    }
    conn.query("SELECT * FROM metodos_pago ORDER BY id", (err, metodos) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json(metodos)
    })
  })
})

routes.post("/metodos-pago/add", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err)
    }
    conn.query("INSERT INTO metodos_pago(nombre) VALUES(?)", [req.body.nombre], (err) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json("Método de pago registrado")
    })
  })
})

routes.post("/metodos-pago/update", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err)
    }
    conn.query("UPDATE metodos_pago SET nombre = ? WHERE id = ?", [req.body.nombre, req.body.id], (err) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json("Método de pago actualizado")
    })
  })
})

routes.post("/metodos-pago/delete", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err)
    }
    conn.query("UPDATE metodos_pago SET activo = 0 WHERE id = ?", [req.body.id], (err) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json("Método de pago desactivado")
    })
  })
})

routes.post("/metodos-pago/activar", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err)
    }
    conn.query("UPDATE metodos_pago SET activo = 1 WHERE id = ?", [req.body.id], (err) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json("Método de pago activado")
    })
  })
})

//Facturas
routes.get("/facturas/lista", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err)
    }
    const { estado } = req.query
    let sql = `SELECT f.FacturaID, f.Total, f.estado, f.Cliente,
                      DATE_FORMAT(f.Fecha, '%d/%m/%Y') as Fecha,
                      TIME_FORMAT(f.Hora, '%h:%i %p') as Hora,
                      DATE_FORMAT(f.fecha_cierre, '%d/%m/%Y %h:%i %p') as fecha_cierre,
                      f.usuario_cobro, f.vuelto, f.MesaID,
                      m.Nombre as MesaNombre,
                      u.usuario as UsuarioCobro,
                      (SELECT COALESCE(SUM(l.Subtotal), 0)
                       FROM lineafactura l WHERE l.FacturaID = f.FacturaID) AS Base,
                      (SELECT COALESCE(SUM(ROUND(b.base * fc.porcentaje) / 100), 0)
                       FROM factura_cargo fc
                       JOIN (SELECT FacturaID, SUM(Subtotal) AS base
                             FROM lineafactura GROUP BY FacturaID) b
                         ON b.FacturaID = fc.FacturaID
                       WHERE fc.FacturaID = f.FacturaID) AS Cargos
               FROM factura f
               LEFT JOIN mesa m ON m.MesaID = f.MesaID
               LEFT JOIN usuario u ON u.idUsuario = f.usuario_cobro`
    let where = []
    if (estado === "abiertas") {
      where.push("f.estado = 1")
    } else if (estado === "cerradas") {
      where.push("f.estado = 0")
    }
    if (where.length > 0) {
      sql += " WHERE " + where.join(" AND ")
    }
    sql += " ORDER BY f.FacturaID DESC"
    conn.query(sql, (err, facturas) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      const lista = (facturas || []).map((fila) => {
        const factura = { ...fila }
        if (Number(factura.estado) === 1) {
          factura.Total = Math.round((Number(factura.Base || 0) + Number(factura.Cargos || 0)) * 100) / 100
        }
        return factura
      })
      res.json(lista)
    })
  })
})

routes.get("/facturas/detalle/:id", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err)
    }
    const FacturaID = req.params.id
  const sqlCabecera = `SELECT f.FacturaID, f.Total, f.estado, f.cierre, f.vuelto, f.MesaID, f.Cliente,
                                DATE_FORMAT(f.Fecha, '%d/%m/%Y') as Fecha,
                                TIME_FORMAT(f.Hora, '%h:%i %p') as Hora,
                                DATE_FORMAT(f.fecha_cierre, '%d/%m/%Y %h:%i %p') as fecha_cierre,
                                m.Nombre as MesaNombre,
                                u.usuario as UsuarioCobro
                         FROM factura f
                         LEFT JOIN mesa m ON m.MesaID = f.MesaID
                         LEFT JOIN usuario u ON u.idUsuario = f.usuario_cobro
                         WHERE f.FacturaID = ?`
    conn.query(sqlCabecera, [FacturaID], (err, cabecera) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      const sqlLineas = `SELECT lf.LineaFacturaID, lf.FacturaID, lf.Cantidad, lf.Subtotal,
                                p.codigo, p.nombre AS Nombre, COALESCE(lf.Precio, p.precio) AS Precio
                         FROM lineafactura lf
                         JOIN producto p ON lf.ProductoID = p.codigo
                         WHERE lf.FacturaID = ?
                         ORDER BY lf.LineaFacturaID`
      conn.query(sqlLineas, [FacturaID], (err, lineas) => {
        if (err) {
          console.log(err)
          return res.send(err)
        }
        const sqlPagos = `SELECT id_pago, FacturaID, metodo_pago, monto,
                                 DATE_FORMAT(fecha, '%d/%m/%Y %h:%i %p') as fecha,
                                 usuario_id, referencia
                          FROM pagos_factura
                          WHERE FacturaID = ?
                          ORDER BY id_pago`
        conn.query(sqlPagos, [FacturaID], (err, pagos) => {
          if (err) {
            console.log(err)
            return res.send(err)
          }
          const sqlCargos = `SELECT idFacturaCargo, FacturaID, idCargo, nombre, porcentaje
                             FROM factura_cargo
                             WHERE FacturaID = ?
                             ORDER BY idFacturaCargo`
          conn.query(sqlCargos, [FacturaID], (err, cargos) => {
            if (err) {
              console.log(err)
              return res.send(err)
            }
            const base = (lineas || []).reduce((acc, l) => acc + Number(l.Subtotal || 0), 0)
            const cargosConMonto = (cargos || []).map((c) => ({
              ...c,
              porcentaje: Number(c.porcentaje),
              monto: Math.round(base * Number(c.porcentaje)) / 100
            }))
            const cabeceraFactura = cabecera[0] ? { ...cabecera[0] } : null
            if (cabeceraFactura && Number(cabeceraFactura.estado) === 1) {
              const totalCargos = cargosConMonto.reduce((acc, c) => acc + Number(c.monto || 0), 0)
              cabeceraFactura.Total = Math.round((base + totalCargos) * 100) / 100
            }
            res.json({
              cabecera: cabeceraFactura,
              lineas: lineas || [],
              pagos: pagos || [],
              cargos: cargosConMonto
            })
          })
        })
      })
    })
  })
})

//Cerrar factura (legacy)
routes.put("/factura/cerrar/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "UPDATE factura set estado=0, fecha_cierre=NOW() WHERE FacturaID = ?",
        [req.body.FacturaID],
        (err, update) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            res.json(update)
          }
        }
      );
    }
  });
});
//Eliminar factura vacia
routes.post("/factura/eliminar/vacia", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "DELETE FROM factura_cargo WHERE FacturaID = ?",
        [req.body.FacturaID],
        (err) => {
          if (err) {
            console.log(err);
            return res.send(err);
          }
          conn.query(
            "DELETE FROM factura WHERE FacturaID = ?",
            [req.body.FacturaID],
            (err, delet) => {
              if (err) {
                console.log(err);
                return res.send(err);
              } else {
                res.json(delet)
              }
            }
          );
        }
      );
    }
  });
});
//Añadir linea de factura
routes.post("/factura/linea/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "INSERT INTO lineafactura(ProductoID,FacturaID,Cantidad,Precio,Subtotal) VALUES(?,?,?,?,?)",
        [req.body.codigo, req.body.FacturaID, req.body.Cantidad, req.body.Precio != null ? req.body.Precio : null, req.body.Subtotal],
        (err, linea) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            conn.query(
              "SELECT MAX(LineaFacturaID) AS ID  from lineafactura",
              (err, lineafactura) => {
                if (err) {
                  console.log(err);
                  return res.send(err);
                } else {
                  res.json(lineafactura)
                }
              }
            );
          }
        }
      );
    }
  });
});
//Obtener ultimo id linea factura
routes.get("/factura/linea/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "SELECT MAX(LineaFacturaID) AS ID  from lineafactura",
        (err, lineafactura) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            res.json(lineafactura)
          }
        }
      );
    }
  });
});
//Actualizar linea de factura
routes.put("/factura/linea/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      //console.log(req.body.Cantidad + " " + req.body.Subtotal + " " + req.body.LineaFacturaID)
      conn.query(
        "UPDATE lineafactura set Cantidad=?, Precio=?, Subtotal=? WHERE LineaFacturaID = ?",
        [req.body.Cantidad, req.body.Precio != null ? req.body.Precio : null, req.body.Subtotal, req.body.LineaFacturaID],
        (err, linea) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            res.json(linea)
          }
        }
      );
    }
  });
});
//Modificar cantidad en una linea factura
routes.put("/factura/linea/delete/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      //console.log(req.body.Cantidad + " " + req.body.Subtotal + " " + req.body.LineaFacturaID)
      conn.query(
        "UPDATE lineafactura set Cantidad=?, Precio=?, Subtotal=? WHERE LineaFacturaID = ?",
        [req.body.Cantidad, req.body.Precio != null ? req.body.Precio : null, req.body.Subtotal, req.body.LineaFacturaID],
        (err, linea) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            res.json(linea)
          }
        }
      );
    }
  });
});
//Eliminar linea factura
routes.post("/linea/delete/", (req, res) => {
  req.getConnection((err, conn) => {
    conn.query("DELETE FROM lineafactura WHERE LineaFacturaID = ?", [req.body.LineaFacturaID], (err, linea) => {
      if (err) {
        return res.send(err)
      } else {
        res.json(linea)
      }
    })
  })
})
//Mover o fusionar una línea entre cuentas de la misma mesa (Tramo 4)
routes.post("/factura/mover-linea/", (req, res) => {
  req.getConnection(async (err, conn) => {
    if (err) {
      return res.send(err);
    }
    const consultar = (sql, valores = []) =>
      new Promise((resolve, reject) => {
        conn.query(sql, valores, (error, resultado) => {
          if (error) return reject(error);
          resolve(resultado);
        });
      });
    const validacion = (mensaje) => {
      const error = new Error(mensaje);
      error.status = 400;
      return error;
    };
    const lineaID = Number(req.body.LineaFacturaID);
    const destinoID = Number(req.body.FacturaDestinoID);
    const cantidadPedida =
      req.body.Cantidad === undefined || req.body.Cantidad === null || req.body.Cantidad === ""
        ? null
        : Math.floor(Number(req.body.Cantidad));
    if (!lineaID || !destinoID) {
      return res.status(400).json({ error: "LineaFacturaID y FacturaDestinoID son requeridos." });
    }
    let enTransaccion = false;
    try {
      // Se localiza la cuenta origen sin bloquear para poder bloquear ambas
      // cuentas siempre en el mismo orden y evitar interbloqueos.
      const ubicacion = await consultar(
        "SELECT FacturaID FROM lineafactura WHERE LineaFacturaID = ?",
        [lineaID]
      );
      if (!ubicacion || ubicacion.length === 0) {
        throw validacion("La línea ya no existe. Actualice la cuenta.");
      }
      const origenID = Number(ubicacion[0].FacturaID);
      if (origenID === destinoID) {
        throw validacion("La línea ya pertenece a esa cuenta.");
      }

      await consultar("START TRANSACTION");
      enTransaccion = true;

      const ids = [origenID, destinoID].sort((a, b) => a - b);
      const cuentasRes = await consultar(
        "SELECT FacturaID, MesaID, estado, Cliente FROM factura WHERE FacturaID IN (?, ?) ORDER BY FacturaID FOR UPDATE",
        ids
      );
      const origenCuenta = cuentasRes.find((c) => Number(c.FacturaID) === origenID);
      const destinoCuenta = cuentasRes.find((c) => Number(c.FacturaID) === destinoID);
      if (!origenCuenta) {
        throw validacion("La cuenta de origen no existe.");
      }
      if (!destinoCuenta) {
        throw validacion("La cuenta destino no existe.");
      }
      if (Number(origenCuenta.estado) !== 1) {
        throw validacion("La cuenta de origen ya está cerrada.");
      }
      if (Number(destinoCuenta.estado) !== 1) {
        throw validacion("La cuenta destino ya está cerrada.");
      }
      if (Number(origenCuenta.MesaID) !== Number(destinoCuenta.MesaID)) {
        throw validacion("Solo se pueden mover productos entre cuentas de la misma mesa.");
      }

      const divisionRes = await consultar(
        `SELECT FacturaID, COUNT(*) AS Pagos
         FROM pagos_factura
         WHERE FacturaID IN (?, ?) AND parte IS NOT NULL
         GROUP BY FacturaID`,
        [origenID, destinoID]
      );
      const enDivision = (divisionRes || []).map((fila) => Number(fila.FacturaID));
      if (enDivision.includes(origenID)) {
        throw validacion("La cuenta de origen está en división. Termine de cobrar las partes antes de mover productos.");
      }
      if (enDivision.includes(destinoID)) {
        throw validacion("La cuenta destino está en división. Termine de cobrar las partes antes de mover productos.");
      }

      const lineasRes = await consultar(
        "SELECT LineaFacturaID, ProductoID, FacturaID, Cantidad, Precio, Subtotal FROM lineafactura WHERE LineaFacturaID = ? FOR UPDATE",
        [lineaID]
      );
      const linea = lineasRes && lineasRes[0];
      if (!linea || Number(linea.FacturaID) !== origenID) {
        throw validacion("La línea ya no pertenece a la cuenta de origen.");
      }
      const cantidadLinea = Math.max(0, Math.floor(Number(linea.Cantidad) || 0));
      if (cantidadLinea <= 0) {
        throw validacion("La línea no tiene cantidad disponible para mover.");
      }
      const cantidad = cantidadPedida === null ? cantidadLinea : cantidadPedida;
      if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > cantidadLinea) {
        throw validacion("La cantidad a mover debe estar entre 1 y " + cantidadLinea + ".");
      }

      // Se conserva el valor exacto de la línea: si el precio fue editado, la
      // parte movida mantiene ese precio y no el del catálogo.
      const subtotalLinea = redondearMoneda(linea.Subtotal);
      const mueveTodaLaLinea = cantidad === cantidadLinea;
      const moverSubtotal = mueveTodaLaLinea
        ? subtotalLinea
        : redondearMoneda((subtotalLinea * cantidad) / cantidadLinea);
      const quedaSubtotal = redondearMoneda(subtotalLinea - moverSubtotal);
      const precioComparable =
        linea.Precio === null || linea.Precio === undefined ? null : redondearMoneda(linea.Precio);

      const destinoLineaRes = await consultar(
        `SELECT LineaFacturaID, Cantidad, Subtotal
         FROM lineafactura
         WHERE FacturaID = ? AND ProductoID = ? AND (Precio <=> ?)
         ORDER BY LineaFacturaID
         LIMIT 1
         FOR UPDATE`,
        [destinoID, linea.ProductoID, precioComparable]
      );
      const destinoLinea = destinoLineaRes && destinoLineaRes[0];
      let lineaDestinoID = 0;
      let fusionada = false;

      if (destinoLinea) {
        // Fusionar: mismo producto y mismo precio. Se suman cantidades y
        // subtotales para no perder el valor editado de la línea.
        fusionada = true;
        lineaDestinoID = Number(destinoLinea.LineaFacturaID);
        await consultar(
          "UPDATE lineafactura SET Cantidad = Cantidad + ?, Subtotal = Subtotal + ? WHERE LineaFacturaID = ?",
          [cantidad, moverSubtotal, lineaDestinoID]
        );
        if (mueveTodaLaLinea) {
          await consultar("DELETE FROM lineafactura WHERE LineaFacturaID = ?", [lineaID]);
        } else {
          await consultar(
            "UPDATE lineafactura SET Cantidad = ?, Subtotal = ? WHERE LineaFacturaID = ?",
            [cantidadLinea - cantidad, quedaSubtotal, lineaID]
          );
        }
      } else if (mueveTodaLaLinea) {
        await consultar(
          "UPDATE lineafactura SET FacturaID = ? WHERE LineaFacturaID = ?",
          [destinoID, lineaID]
        );
        lineaDestinoID = lineaID;
      } else {
        const insertada = await consultar(
          "INSERT INTO lineafactura(ProductoID, FacturaID, Cantidad, Precio, Subtotal) VALUES (?, ?, ?, ?, ?)",
          [linea.ProductoID, destinoID, cantidad, precioComparable, moverSubtotal]
        );
        lineaDestinoID = Number((insertada && insertada.insertId) || 0);
        if (!lineaDestinoID) {
          const ultima = await consultar("SELECT MAX(LineaFacturaID) AS ID FROM lineafactura");
          lineaDestinoID = Number((ultima[0] || {}).ID || 0);
        }
        await consultar(
          "UPDATE lineafactura SET Cantidad = ?, Subtotal = ? WHERE LineaFacturaID = ?",
          [cantidadLinea - cantidad, quedaSubtotal, lineaID]
        );
      }

      const origenVaciaRes = await consultar(
        "SELECT COUNT(*) AS n FROM lineafactura WHERE FacturaID = ?",
        [origenID]
      );
      const origenVacia = Number((origenVaciaRes[0] || {}).n || 0) === 0;

      await consultar("COMMIT");
      enTransaccion = false;
      res.json({
        success: true,
        LineaFacturaID: lineaID,
        LineaDestinoID: lineaDestinoID,
        FacturaOrigenID: origenID,
        FacturaDestinoID: destinoID,
        Cantidad: cantidad,
        Subtotal: moverSubtotal,
        fusionada,
        origenVacia
      });
    } catch (error) {
      if (enTransaccion) {
        try {
          await consultar("ROLLBACK");
        } catch (rollbackError) {
          console.log(rollbackError);
        }
      }
      console.log(error);
      return res.status(error.status || 500).json({
        error: error.status ? error.message : "No se pudo mover el producto entre cuentas."
      });
    }
  });
});

//Actualizar Total en Factura
routes.put("/factura/Total/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "UPDATE factura set Total = ? WHERE FacturaID = ?",
        [req.body.Total, req.body.FacturaID],
        (err, factura) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            res.json(factura)
          }
        }
      );
    }
  });
});

// Eliminar Factura mediante POST
routes.post("/facturas/eliminar/", (req, res) => {
  const { FacturaID } = req.body;

  req.getConnection((err, conn) => {
    if (err) return res.send(err);
    if (!FacturaID) return res.status(400).json({ error: "FacturaID requerido" });

    conn.query("DELETE FROM lineafactura WHERE FacturaID = ?", [FacturaID], (err) => {
      if (err) return res.send(err);

      conn.query("DELETE FROM pagos_factura WHERE FacturaID = ?", [FacturaID], (err) => {
        if (err) return res.send(err);

        conn.query("DELETE FROM factura_cargo WHERE FacturaID = ?", [FacturaID], (err) => {
          if (err) return res.send(err);

          conn.query("DELETE FROM factura WHERE FacturaID = ?", [FacturaID], (err, factura) => {
            if (err) {
              console.log(err);
              return res.send(err);
            } else {
              res.json(factura);
            }
          });
        });
      });
    });
  });
});

// Vista previa: borrado masivo por fechas
routes.post("/facturas/eliminar/por-fechas/preview", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err);
    const fechaDesde = req.body.fechaDesde;
    const fechaHasta = req.body.fechaHasta;
    const aplicarA = (req.body.aplicarA || "cerradas").toString().toLowerCase();

    if (!fechaDesde || !fechaHasta) {
      return res.status(400).json({ error: "Debe seleccionar fecha Desde y Hasta" });
    }
    if (!["cerradas", "abiertas", "todas"].includes(aplicarA)) {
      return res.status(400).json({ error: "aplicarA debe ser cerradas, abiertas o todas" });
    }

    let where = "";
    let params = [];

    if (aplicarA === "cerradas") {
      where = "f.estado = 0 AND f.fecha_cierre >= ? AND f.fecha_cierre <= ?";
      params = [fechaDesde + " 00:00:00", fechaHasta + " 23:59:59"];
    } else if (aplicarA === "abiertas") {
      where = "f.estado = 1 AND f.Fecha >= ? AND f.Fecha <= ?";
      params = [fechaDesde, fechaHasta];
    } else {
      where = "((f.estado = 0 AND f.fecha_cierre >= ? AND f.fecha_cierre <= ?) OR (f.estado = 1 AND f.Fecha >= ? AND f.Fecha <= ?))";
      params = [fechaDesde + " 00:00:00", fechaHasta + " 23:59:59", fechaDesde, fechaHasta];
    }

    const sql = `SELECT f.FacturaID, f.MesaID, f.NombreMesa, f.Cliente, f.Total, f.estado, f.Fecha, f.fecha_cierre, u.usuario AS UsuarioCobro
                 FROM factura f
                 LEFT JOIN usuario u ON u.idUsuario = f.usuario_cobro
                 WHERE ${where}
                 ORDER BY COALESCE(f.fecha_cierre, f.Fecha), f.FacturaID
                 LIMIT 500`;
    conn.query(sql, params, (err, filas) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ error: "No se pudo obtener la vista previa" });
      }
      const lista = filas || [];
      const total = lista.reduce((acc, f) => acc + Number(f.Total || 0), 0);
      res.json({
        ok: true,
        aplicarA,
        fechaDesde,
        fechaHasta,
        count: lista.length,
        total: Math.round(total * 100) / 100,
        facturas: lista
      });
    });
  });
});

// Borrado masivo por fechas (requiere confirmación doble)
routes.post("/facturas/eliminar/por-fechas", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err);
    const fechaDesde = req.body.fechaDesde;
    const fechaHasta = req.body.fechaHasta;
    const aplicarA = (req.body.aplicarA || "cerradas").toString().toLowerCase();
    const confirmarCheck = req.body.confirmarCheck === true;
    const confirmarTexto = (req.body.confirmarTexto || "").toString().trim().toUpperCase();

    if (!fechaDesde || !fechaHasta) {
      return res.status(400).json({ error: "Debe seleccionar fecha Desde y Hasta" });
    }
    if (!["cerradas", "abiertas", "todas"].includes(aplicarA)) {
      return res.status(400).json({ error: "aplicarA debe ser cerradas, abiertas o todas" });
    }
    if (!confirmarCheck || confirmarTexto !== "ELIMINAR") {
      return res.status(400).json({ error: "Confirmación doble requerida: marque la casilla y escriba ELIMINAR" });
    }

    let where = "";
    let params = [];

    if (aplicarA === "cerradas") {
      where = "estado = 0 AND fecha_cierre >= ? AND fecha_cierre <= ?";
      params = [fechaDesde + " 00:00:00", fechaHasta + " 23:59:59"];
    } else if (aplicarA === "abiertas") {
      where = "estado = 1 AND Fecha >= ? AND Fecha <= ?";
      params = [fechaDesde, fechaHasta];
    } else {
      where = "((estado = 0 AND fecha_cierre >= ? AND fecha_cierre <= ?) OR (estado = 1 AND Fecha >= ? AND Fecha <= ?))";
      params = [fechaDesde + " 00:00:00", fechaHasta + " 23:59:59", fechaDesde, fechaHasta];
    }

    conn.beginTransaction((err) => {
      if (err) return res.send(err);

      const sqlSelect = `SELECT FacturaID FROM factura WHERE ${where}`;
      conn.query(sqlSelect, params, (err, filas) => {
        if (err) return conn.rollback(() => res.status(500).json({ error: "Error al buscar facturas a eliminar" }));
        const ids = (filas || []).map((f) => f.FacturaID);
        if (ids.length === 0) {
          return conn.rollback(() => res.status(400).json({ error: "No hay facturas que coincidan con ese rango" }));
        }

        const borrarEnOrden = (i) => {
          if (i >= ids.length) {
            return conn.commit((err) => {
              if (err) return conn.rollback(() => res.status(500).json({ error: "Error al confirmar borrado masivo" }));
              res.json({ ok: true, eliminadas: ids.length, ids });
            });
          }
          const facturaId = ids[i];
          conn.query("DELETE FROM pagos_factura WHERE FacturaID = ?", [facturaId], (err) => {
            if (err) return conn.rollback(() => res.status(500).json({ error: "Error al eliminar pagos en borrado masivo" }));
            conn.query("DELETE FROM lineafactura WHERE FacturaID = ?", [facturaId], (err) => {
              if (err) return conn.rollback(() => res.status(500).json({ error: "Error al eliminar líneas en borrado masivo" }));
              conn.query("DELETE FROM factura_cargo WHERE FacturaID = ?", [facturaId], (err) => {
                if (err) return conn.rollback(() => res.status(500).json({ error: "Error al eliminar cargos en borrado masivo" }));
                conn.query("DELETE FROM factura WHERE FacturaID = ?", [facturaId], (err) => {
                  if (err) return conn.rollback(() => res.status(500).json({ error: "Error al eliminar factura en borrado masivo" }));
                  borrarEnOrden(i + 1);
                });
              });
            });
          });
        };
        borrarEnOrden(0);
      });
    });
  });
});
// ---- Cierre de caja (Fase 3) ----
// Resumen de las facturas cerradas pendientes de cierre (no modifica nada).
routes.get("/cierre/pendientes/", (req, res) => {
  req.getConnection(async (err, conn) => {
    if (err) {
      return res.send(err);
    }
    const consultar = (sql, valores = []) =>
      new Promise((resolve, reject) => {
        conn.query(sql, valores, (error, resultado) => {
          if (error) return reject(error);
          resolve(resultado);
        });
      });
    try {
      const facturas = await leerFacturasPendientesCierre(consultar);
      const ids = facturas.map((f) => f.FacturaID);
      const metodos = await leerMetodosCierre(consultar, ids);
      res.json({
        Facturas: facturas,
        Metodos: metodos,
        Resumen: resumenCierreDesdeFacturas(facturas, metodos)
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({ error: "No se pudo consultar el cierre de caja." });
    }
  });
});

// Crea un cierre de caja con las facturas indicadas y guarda el histórico.
// La UI envía los IDs que el usuario confirmó en el resumen.
routes.post("/cierre/", (req, res) => {
  req.getConnection(async (err, conn) => {
    if (err) {
      return res.send(err);
    }
    const consultar = (sql, valores = []) =>
      new Promise((resolve, reject) => {
        conn.query(sql, valores, (error, resultado) => {
          if (error) return reject(error);
          resolve(resultado);
        });
      });
    const validacion = (mensaje) => {
      const error = new Error(mensaje);
      error.status = 400;
      return error;
    };
    const ids = Array.from(
      new Set(
        (Array.isArray(req.body.FacturaIDs) ? req.body.FacturaIDs : [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );
    if (ids.length === 0) {
      return res.status(400).json({ error: "Seleccione al menos una factura para cerrar." });
    }
    if (ids.length > 5000) {
      return res.status(400).json({ error: "Demasiadas facturas en un solo cierre." });
    }
    let efectivoContado = null;
    if (
      req.body.efectivo_contado !== undefined &&
      req.body.efectivo_contado !== null &&
      String(req.body.efectivo_contado).trim() !== ""
    ) {
      efectivoContado = Number(req.body.efectivo_contado);
      if (!Number.isFinite(efectivoContado) || efectivoContado < 0) {
        return res
          .status(400)
          .json({ error: "El efectivo contado debe ser un monto válido mayor o igual a cero." });
      }
      efectivoContado = redondearMoneda(efectivoContado);
    }
    const observaciones = String(req.body.observaciones || "").trim().slice(0, 255);
    const usuarioID = Number(req.body.usuario_id) || null;
    let enTransaccion = false;
    try {
      let usuarioNombre = null;
      if (usuarioID) {
        const usuarioRes = await consultar(
          "SELECT usuario FROM usuario WHERE idUsuario = ?",
          [usuarioID]
        );
        usuarioNombre = usuarioRes && usuarioRes[0] ? usuarioRes[0].usuario : null;
      }

      await consultar("START TRANSACTION");
      enTransaccion = true;

      const facturas = await consultar(
        `SELECT FacturaID, MesaID, NombreMesa, Cliente, Total, vuelto, fecha_cierre
         FROM factura
         WHERE FacturaID IN (?) AND estado = 0 AND cierre = 0
         ORDER BY FacturaID
         FOR UPDATE`,
        [ids]
      );
      if (!facturas || facturas.length !== ids.length) {
        throw validacion(
          "Algunas facturas ya se cerraron o no están disponibles. Actualice el resumen e intente de nuevo."
        );
      }
      const metodos = await leerMetodosCierre(consultar, ids);
      const resumen = resumenCierreDesdeFacturas(facturas, metodos);
      const diferencia =
        efectivoContado === null
          ? null
          : redondearMoneda(efectivoContado - resumen.EfectivoNeto);

      const creado = await consultar(
        `INSERT INTO cierre_caja
           (fecha, usuario_id, usuario, desde, hasta, facturas, total,
            efectivo_recibido, vuelto, efectivo_neto, efectivo_contado,
            diferencia, observaciones)
         VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          usuarioID,
          usuarioNombre,
          resumen.Desde,
          resumen.Hasta,
          resumen.CantidadFacturas,
          resumen.Total,
          resumen.EfectivoRecibido,
          resumen.Vuelto,
          resumen.EfectivoNeto,
          efectivoContado,
          diferencia,
          observaciones === "" ? null : observaciones
        ]
      );
      const cierreID = Number((creado && creado.insertId) || 0);
      if (!cierreID) {
        throw new Error("No se pudo obtener el ID del cierre.");
      }

      for (const metodo of metodos) {
        await consultar(
          `INSERT INTO cierre_caja_pago(CierreID, metodo_pago, cantidad, monto)
           VALUES (?, ?, ?, ?)`,
          [cierreID, metodo.metodo_pago, metodo.cantidad, metodo.monto]
        );
      }
      for (const factura of facturas) {
        await consultar(
          `INSERT INTO cierre_caja_factura
             (CierreID, FacturaID, Total, MesaID, NombreMesa, Cliente, fecha_cierre)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            cierreID,
            factura.FacturaID,
            redondearMoneda(factura.Total),
            factura.MesaID,
            factura.NombreMesa,
            factura.Cliente,
            factura.fecha_cierre
          ]
        );
      }

      const actualizado = await consultar(
        "UPDATE factura SET cierre = 1 WHERE FacturaID IN (?) AND estado = 0 AND cierre = 0",
        [ids]
      );
      if (Number(actualizado.affectedRows) !== ids.length) {
        throw validacion(
          "No se pudieron cerrar todas las facturas. Actualice el resumen e intente de nuevo."
        );
      }

      const cierre = await leerCierreCaja(consultar, cierreID);
      await consultar("COMMIT");
      enTransaccion = false;
      res.json({ ok: true, Cierre: cierre });
    } catch (error) {
      if (enTransaccion) {
        try {
          await consultar("ROLLBACK");
        } catch (rollbackError) {
          console.log(rollbackError);
        }
      }
      console.log(error);
      return res.status(error.status || 500).json({
        error: error.status ? error.message : "No se pudo guardar el cierre de caja."
      });
    }
  });
});

// Histórico de cierres (cabecera, sin detalle).
routes.get("/cierre/historial/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    }
    conn.query(
      `SELECT c.*, u.usuario AS Usuario
       FROM cierre_caja c
       LEFT JOIN usuario u ON u.idUsuario = c.usuario_id
       ORDER BY c.CierreID DESC
       LIMIT 200`,
      (error, filas) => {
        if (error) {
          console.log(error);
          return res.status(500).json({ error: "No se pudo consultar el histórico de cierres." });
        }
        res.json(
          (filas || []).map((c) => ({
            CierreID: Number(c.CierreID),
            fecha: c.fecha,
            usuario_id: c.usuario_id,
            usuario: c.Usuario || c.usuario || null,
            desde: c.desde,
            hasta: c.hasta,
            CantidadFacturas: Number(c.facturas || 0),
            Total: redondearMoneda(c.total),
            EfectivoRecibido: redondearMoneda(c.efectivo_recibido),
            Vuelto: redondearMoneda(c.vuelto),
            EfectivoNeto: redondearMoneda(c.efectivo_neto),
            EfectivoContado:
              c.efectivo_contado === null ? null : redondearMoneda(c.efectivo_contado),
            Diferencia: c.diferencia === null ? null : redondearMoneda(c.diferencia),
            Observaciones: c.observaciones || null
          }))
        );
      }
    );
  });
});

// Detalle de un cierre (cabecera + métodos + facturas incluidas).
routes.get("/cierre/:id", (req, res) => {
  const cierreID = Number(req.params.id);
  if (!Number.isInteger(cierreID) || cierreID <= 0) {
    return res.status(400).json({ error: "CierreID inválido." });
  }
  req.getConnection(async (err, conn) => {
    if (err) {
      return res.send(err);
    }
    const consultar = (sql, valores = []) =>
      new Promise((resolve, reject) => {
        conn.query(sql, valores, (error, resultado) => {
          if (error) return reject(error);
          resolve(resultado);
        });
      });
    try {
      const cierre = await leerCierreCaja(consultar, cierreID);
      if (!cierre) {
        return res.status(404).json({ error: "El cierre no existe." });
      }
      res.json(cierre);
    } catch (error) {
      console.log(error);
      res.status(500).json({ error: "No se pudo consultar el cierre." });
    }
  });
});
//---------Añadir Categoria-----------------
routes.post("/Categoria/add", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "INSERT INTO categoria(Descripcion) VALUES(?)",
        [req.body.categoria],
        (err, categoriaDB) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            res.json(
              "La Categoria " + req.body.categoria + " ha sido Registrada!!"
            );
          }
        }
      );
    }
  });
});

//---------Actualizar Categorias-----------------
routes.post("/Categoria/update", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "UPDATE categoria set Descripcion = ? WHERE idCategoria = ?",
        [req.body.categoria, req.body.categoriaAntigua],
        (err, categoriaDB) => {
          if (err) {
            return res.send(err);
          } else {
            res.json(
              "La categoria " +
              req.body.categoria +
              " ha sido modificada exitosamente"
            );
          }
        }
      );
    }
  });
});

//---------Eliminar Categorias-----------------
routes.post("/Categoria/delete", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "DELETE FROM categoria WHERE idCategoria = ?",
        [req.body.categoria],
        (err, categoria) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            res.send("Eliminada la categoria: ");
          }
        }
      );
    }
  });
});

//---------Añadir Productos-----------------
routes.post("/Productos/add", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "INSERT INTO producto(nombre,idCategoria,descripcion,precio) VALUES(?,?,?,?)",
        [
          req.body.nombreProducto,
          req.body.categoria,
          req.body.descripcionProducto,
          req.body.precioProducto,
        ],
        (err) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            res.json(
              "El producto " + req.body.nombreProducto + " ha sido Registrado!!"
            );
          }
        }
      );
    }
  });
});

//---------Eliminar Producto-----------------
routes.post("/Producto/delete", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "DELETE FROM producto WHERE codigo = ?",
        [req.body.idProducto],
        (err, categoria) => {
          if (err) {
            console.log(err);
            return res.send(err);
          } else {
            res.send("Eliminado el Producto: " + req.body.idProducto);
          }
        }
      );
    }
  });
});

//---------Actualizar Producto-----------------
routes.post("/Producto/actualizar", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) {
      return res.send(err);
    } else {
      conn.query(
        "UPDATE producto set nombre = ?, descripcion=?, precio=? WHERE codigo = ?",
        [
          req.body.nombre,
          req.body.descripcion,
          req.body.precio,
          req.body.codigo,
        ],
        (err, categoriaDB) => {
          if (err) {
            return res.send(err);
          } else {
            res.json(
              "El producto " +
              req.body.nombre +
              " ha sido modificado exitosamente"
            );
          }
        }
      );
    }
  });
});

//---------Configuración del ticket (machote de impresión)-----------
const CAMPOS_CONFIG_TICKET = [
  "nombre_negocio", "cedula", "telefono", "direccion", "email", "sitio_web",
  "encabezado_extra", "leyenda_pie",
  "ancho_mm", "tamano_fuente", "formato_moneda",
  "etiqueta_prefactura", "etiqueta_factura",
  "mostrar_cedula", "mostrar_telefono", "mostrar_direccion", "mostrar_email", "mostrar_sitio",
  "mostrar_fecha", "mostrar_hora", "mostrar_mesa", "mostrar_cliente", "mostrar_cajero",
  "mostrar_numero", "mostrar_cantidad", "mostrar_precio_unitario", "mostrar_subtotal_linea",
  "mostrar_subtotal", "mostrar_impuesto", "impuesto_porcentaje", "impuesto_incluido",
  "mostrar_pagos", "mostrar_vuelto"
]

routes.get("/configuracion/ticket", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err)
    conn.query("SELECT * FROM configuracion_ticket WHERE id = 1", (err, filas) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json((filas && filas[0]) || {})
    })
  })
})

routes.put("/configuracion/ticket", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err)
    const body = req.body || {}
    const columnas = []
    const valores = []
    CAMPOS_CONFIG_TICKET.forEach((campo) => {
      if (body[campo] !== undefined) {
        columnas.push(campo)
        valores.push(body[campo] === "" ? null : body[campo])
      }
    })
    if (columnas.length === 0) {
      return res.status(400).json({ error: "Sin datos para actualizar" })
    }
    const updates = columnas.map((c) => c + " = ?").join(", ")
    conn.query("SELECT id FROM configuracion_ticket WHERE id = 1", (err, existe) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      if (existe && existe.length > 0) {
        conn.query("UPDATE configuracion_ticket SET " + updates + " WHERE id = 1", valores, (err) => {
          if (err) {
            console.log(err)
            return res.send(err)
          }
          res.json({ ok: true })
        })
      } else {
        const sql = "INSERT INTO configuracion_ticket (id, " + columnas.join(", ") + ") VALUES (1, " +
          columnas.map(() => "?").join(", ") + ")"
        conn.query(sql, valores, (err) => {
          if (err) {
            console.log(err)
            return res.send(err)
          }
          res.json({ ok: true })
        })
      }
    })
  })
})

//---------Cliente de la factura-----------
routes.put("/factura/cliente/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err)
    const cliente = (req.body.Cliente || "").toString().trim()
    conn.query("UPDATE factura SET Cliente = ? WHERE FacturaID = ?",
      [cliente === "" ? null : cliente, req.body.FacturaID], (err) => {
        if (err) {
          console.log(err)
          return res.send(err)
        }
        res.json({ ok: true })
      })
  })
})

routes.get("/factura/cliente/:id", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err)
    conn.query("SELECT Cliente FROM factura WHERE FacturaID = ?", [req.params.id], (err, filas) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json({ Cliente: (filas && filas[0] && filas[0].Cliente) || "" })
    })
  })
})

//---------Cargos por porcentaje (servicio, propina, etc.)-----------
const normalizarPorcentaje = (valor) => {
  const numero = Number(valor)
  if (isNaN(numero) || numero < 0 || numero > 100) return null
  return Math.round(numero * 100) / 100
}

const normalizarBandera = (valor) => (Number(valor) === 1 ? 1 : 0)

routes.get("/cargos/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err)
    conn.query("SELECT * FROM `cargo` WHERE activo = 1 ORDER BY idCargo", (err, filas) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json(filas || [])
    })
  })
})

routes.get("/cargos/all", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err)
    conn.query("SELECT * FROM `cargo` ORDER BY idCargo", (err, filas) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json(filas || [])
    })
  })
})

routes.post("/cargos/add", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err)
    const nombre = (req.body.nombre || "").toString().trim().toUpperCase()
    const porcentaje = normalizarPorcentaje(req.body.porcentaje)
    const predeterminado = normalizarBandera(req.body.predeterminado)
    if (nombre === "" || porcentaje === null) {
      return res.status(400).json({ error: "Nombre y porcentaje (0-100) son requeridos" })
    }
    conn.query("INSERT INTO `cargo` (nombre, porcentaje, predeterminado, activo) VALUES (?, ?, ?, 1)",
      [nombre, porcentaje, predeterminado], (err, result) => {
        if (err) {
          console.log(err)
          return res.status(400).json({ error: "No se pudo agregar (¿nombre repetido?)" })
        }
        res.json({ ok: true, idCargo: result.insertId })
      })
  })
})

routes.post("/cargos/update", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err)
    const idCargo = req.body.idCargo || req.body.id
    const nombre = (req.body.nombre || "").toString().trim().toUpperCase()
    const porcentaje = normalizarPorcentaje(req.body.porcentaje)
    const predeterminado = req.body.predeterminado === undefined || req.body.predeterminado === null
      ? null
      : normalizarBandera(req.body.predeterminado)
    if (!idCargo || nombre === "" || porcentaje === null) {
      return res.status(400).json({ error: "Datos incompletos" })
    }
    conn.query("UPDATE `cargo` SET nombre = ?, porcentaje = ?, predeterminado = COALESCE(?, predeterminado) WHERE idCargo = ?",
      [nombre, porcentaje, predeterminado, idCargo], (err) => {
        if (err) {
          console.log(err)
          return res.status(400).json({ error: "No se pudo actualizar (¿nombre repetido?)" })
        }
        res.json({ ok: true })
      })
  })
})

routes.post("/cargos/delete", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err)
    const idCargo = req.body.idCargo || req.body.id
    conn.query("UPDATE `cargo` SET activo = 0 WHERE idCargo = ?", [idCargo], (err) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json({ ok: true })
    })
  })
})

routes.post("/cargos/activar", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err)
    const idCargo = req.body.idCargo || req.body.id
    conn.query("UPDATE `cargo` SET activo = 1 WHERE idCargo = ?", [idCargo], (err) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json({ ok: true })
    })
  })
})

routes.get("/factura/cargos/:id", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err)
    conn.query("SELECT idFacturaCargo, FacturaID, idCargo, nombre, porcentaje FROM factura_cargo WHERE FacturaID = ? ORDER BY idFacturaCargo",
      [req.params.id], (err, filas) => {
        if (err) {
          console.log(err)
          return res.send(err)
        }
        res.json((filas || []).map((f) => ({ ...f, porcentaje: Number(f.porcentaje) })))
      })
  })
})

routes.post("/factura/cargo/", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err)
    const FacturaID = req.body.FacturaID
    const idCargo = req.body.idCargo || null
    const nombre = (req.body.nombre || "").toString().trim().toUpperCase()
    const porcentaje = normalizarPorcentaje(req.body.porcentaje)
    if (!FacturaID || nombre === "" || porcentaje === null) {
      return res.status(400).json({ error: "FacturaID, nombre y porcentaje (0-100) son requeridos" })
    }
    conn.query("INSERT INTO factura_cargo (FacturaID, idCargo, nombre, porcentaje) VALUES (?, ?, ?, ?)",
      [FacturaID, idCargo, nombre, porcentaje], (err, result) => {
        if (err) {
          console.log(err)
          return res.send(err)
        }
        res.json({ ok: true, idFacturaCargo: result.insertId })
      })
  })
})

routes.post("/factura/cargo/delete", (req, res) => {
  req.getConnection((err, conn) => {
    if (err) return res.send(err)
    conn.query("DELETE FROM factura_cargo WHERE idFacturaCargo = ?", [req.body.idFacturaCargo], (err) => {
      if (err) {
        console.log(err)
        return res.send(err)
      }
      res.json({ ok: true })
    })
  })
})

module.exports = routes;
