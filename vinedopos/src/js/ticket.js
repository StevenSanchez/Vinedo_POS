/**
 * ============================================================================
 * ARCHIVO: src/js/ticket.js
 * PROPÓSITO: generador ÚNICO del ticket (prefactura y factura) y su impresión.
 * Lo usan pedidos.js, facturas.js y configuracionTicket.js.
 *
 * EXPORTS:
 *  - CONFIG_TICKET_DEFAULT   valores por defecto si la BD no responde
 *  - obtenerConfigTicket()   GET /configuracion/ticket + merge con defaults
 *  - si(valor)               true si el valor numérico es 1
 *  - formatearMoneda()       cr / us / plano
 *  - montoCargo(base, pct)   base * pct / 100 redondeado a 2 decimales
 *  - fechaHoraActual()       fecha y hora locales (es-CR)
 *  - datosDesdeDetalle()     adapta la respuesta de /facturas/detalle/:id
 *  - construirTicketHTML()   devuelve el documento HTML completo
 *  - imprimirTicket(html)    imprime en un iframe oculto; devuelve Promesa
 *
 * DATOS OPCIONALES:
 *  - datos.nota: texto breve bajo la etiqueta PREFACTURA/FACTURA.
 *
 * TOTALES:
 *  1. sumaLineas = suma de Subtotal.
 *  2. cargos se calculan sobre sumaLineas (nunca se guarda el monto).
 *  3. totalBase = datos.total o sumaLineas + cargos.
 *  4. Si mostrar_impuesto = 1:
 *       impuesto_incluido = 1 -> despeja el IVA del total
 *       impuesto_incluido = 0 -> suma el IVA al total
 *  5. Con cargos se imprime "Subtotal" (solo productos), cada cargo y TOTAL.
 *
 * IMPRESIÓN:
 *  - iframe fuera de pantalla; se escribe solo el HTML del ticket.
 *  - Chrome exige DOS medidas en @page; se mide el contenido y se reescribe
 *    #page-size antes de imprimir (ver sección 9 de la documentación).
 *  - Con --kiosk-printing (POS sin dialogo.bat) imprime sin diálogo.
 * ============================================================================
 */
import axios from "axios";
import { ruta } from "../Ruta/ruta";

const baseUrl = ruta.baseUrl;

// Configuración por defecto: se usa si la BD no responde o faltan campos
export const CONFIG_TICKET_DEFAULT = {
  nombre_negocio: "La Casa del Viñedo",
  cedula: "155808313612",
  telefono: "2487-83-26",
  direccion: "Del cruce de Turrucares, 600 mts oeste, carretera a Atenas, contiguo a la fábrica de vinos VICOSA",
  email: "",
  sitio_web: "",
  encabezado_extra: "",
  leyenda_pie: "¡Muchas gracias por su visita!",
  ancho_mm: 80,
  tamano_fuente: 10,
  formato_moneda: "cr",
  etiqueta_prefactura: "PREFACTURA",
  etiqueta_factura: "FACTURA",
  mostrar_cedula: 1,
  mostrar_telefono: 1,
  mostrar_direccion: 1,
  mostrar_email: 0,
  mostrar_sitio: 0,
  mostrar_fecha: 1,
  mostrar_hora: 1,
  mostrar_mesa: 1,
  mostrar_cliente: 1,
  mostrar_cajero: 1,
  mostrar_numero: 1,
  mostrar_cantidad: 1,
  mostrar_precio_unitario: 0,
  mostrar_subtotal_linea: 1,
  mostrar_subtotal: 0,
  mostrar_impuesto: 0,
  impuesto_porcentaje: 13,
  impuesto_incluido: 1,
  mostrar_pagos: 1,
  mostrar_vuelto: 1
};

export const obtenerConfigTicket = async () => {
  try {
    const res = await axios.get(baseUrl + "configuracion/ticket");
    return { ...CONFIG_TICKET_DEFAULT, ...(res.data || {}) };
  } catch (error) {
    return { ...CONFIG_TICKET_DEFAULT };
  }
};

export const si = (valor) => Number(valor) === 1;

export const formatearMoneda = (valor, formato = "cr") => {
  const numero = Number(valor || 0);
  const seguro = isNaN(numero) ? 0 : numero;
  if (formato === "plano") {
    return String(Math.round(seguro * 100) / 100);
  }
  const [entero, decimal] = seguro.toFixed(2).split(".");
  const separadorMiles = formato === "us" ? "," : ".";
  const separadorDecimal = formato === "us" ? "." : ",";
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, separadorMiles);
  return "₡" + conMiles + separadorDecimal + decimal;
};

const escapar = (texto) =>
  String(texto === null || texto === undefined ? "" : texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const lineasDeTexto = (texto) =>
  String(texto || "")
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea !== "");

// Monto de un cargo por porcentaje sobre la base (solo líneas de la cuenta)
export const montoCargo = (base, porcentaje) => {
  const monto = (Number(base) || 0) * (Number(porcentaje) || 0) / 100;
  return Math.round(monto * 100) / 100;
};

const formatearPorcentaje = (porcentaje) => {
  const numero = Number(porcentaje) || 0;
  return Number.isInteger(numero) ? String(numero) : String(Math.round(numero * 100) / 100);
};

export const fechaHoraActual = () => {
  const ahora = new Date();
  return {
    fecha: ahora.toLocaleDateString("es-CR", { day: "2-digit", month: "2-digit", year: "numeric" }),
    hora: ahora.toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })
  };
};

// Devuelve SOLO las guarniciones visibles al cliente, con su grupo y precio.
// El término de carne y demás opciones internas nunca salen en el ticket.
export const guarnicionesTicket = (linea) => {
  if (!linea) return [];
  const normalizar = (m) => ({
    Grupo: m.GrupoNombre || m.Grupo || "Guarnición",
    Nombre: m.ItemNombre || m.Nombre || m.nombre || "",
    Precio: Number(
      m.PrecioExtra !== undefined && m.PrecioExtra !== null
        ? m.PrecioExtra
        : m.Precio !== undefined && m.Precio !== null
          ? m.Precio
          : 0
    ) || 0
  });

  const detalle = linea._guarnicionesDetalle || linea.GuarnicionesDetalle;
  if (Array.isArray(detalle) && detalle.length > 0) {
    return detalle.map(normalizar).filter((g) => g.Nombre);
  }

  const mods = Array.isArray(linea.Modificadores) ? linea.Modificadores : [];
  const esInterno = (m) =>
    Number(m.SoloInterno) === 1 || /t[eé]rmino/i.test(String(m.GrupoNombre || ""));
  const visibles = mods.filter((m) => !esInterno(m));
  if (visibles.length > 0) {
    return visibles.map(normalizar).filter((g) => g.Nombre);
  }

  const compactas = linea._guarnicionesCompactas || linea.guarnicionesCompactas;
  if (Array.isArray(compactas)) {
    return compactas
      .map((m) => (typeof m === "string" ? m : normalizar(m).Nombre))
      .filter(Boolean)
      .map((Nombre) => ({ Grupo: "Guarnición", Nombre, Precio: 0 }));
  }
  if (typeof compactas === "string" && compactas.trim()) {
    return compactas
      .split(",")
      .map((Nombre) => Nombre.trim())
      .filter(Boolean)
      .map((Nombre) => ({ Grupo: "Guarnición", Nombre, Precio: 0 }));
  }

  const guarn = linea.Guarniciones || linea.guarniciones;
  if (Array.isArray(guarn)) {
    return guarn
      .map((m) => (typeof m === "string" ? m : normalizar(m).Nombre))
      .filter(Boolean)
      .map((Nombre) => ({ Grupo: "Guarnición", Nombre, Precio: 0 }));
  }
  if (typeof guarn === "string" && guarn.trim()) {
    return guarn
      .split(",")
      .map((Nombre) => Nombre.trim())
      .filter(Boolean)
      .map((Nombre) => ({ Grupo: "Guarnición", Nombre, Precio: 0 }));
  }
  return [];
};

export const datosDesdeDetalle = (detalle, modo) => {
  const cab = (detalle && detalle.cabecera) || {};
  const lineas = (detalle && detalle.lineas) || [];
  const pagos = (detalle && detalle.pagos) || [];
  const suma = lineas.reduce((acc, l) => acc + Number(l.Subtotal || 0), 0);
  const cargos = ((detalle && detalle.cargos) || []).map((c) => ({
    nombre: c.nombre || "",
    porcentaje: Number(c.porcentaje || 0),
    monto: c.monto !== undefined && c.monto !== null
      ? Number(c.monto)
      : montoCargo(suma, c.porcentaje)
  }));
  const sumaCargos = cargos.reduce((acc, c) => acc + Number(c.monto || 0), 0);
  const total = Number(cab.Total || 0) > 0 ? Number(cab.Total) : suma + sumaCargos;
  return {
    numero: cab.FacturaID || "",
    fecha: cab.fecha_cierre ? String(cab.fecha_cierre).split(" ")[0] : cab.Fecha || "",
    hora: cab.Hora || "",
    mesa: cab.MesaNombre || "",
    cliente: cab.Cliente || "",
    cajero: cab.UsuarioCobro || "",
    lineas: lineas.map((l) => ({
      Nombre: l.Nombre || "",
      Cantidad: Number(l.Cantidad || 0),
      Precio: Number(l.Precio || 0),
      Subtotal: Number(l.Subtotal || 0),
      _guarnicionesDetalle: guarnicionesTicket(l)
    })),
    cargos,
    total,
    pagos: pagos.map((p) => ({ metodo_pago: p.metodo_pago || "", monto: Number(p.monto || 0) })),
    vuelto: Number(cab.vuelto || 0),
    modo: modo || "factura"
  };
};

const fila = (etiqueta, valor, claseValor) => {
  if (valor === null || valor === undefined || String(valor).trim() === "") return "";
  return `<div class="fila"><span class="etq">${escapar(etiqueta)}</span>` +
    `<span class="val ${claseValor || ""}">${escapar(valor)}</span></div>`;
};

export const construirTicketHTML = (datos, configEntrada, modo) => {
  const config = { ...CONFIG_TICKET_DEFAULT, ...(configEntrada || {}) };
  const tipo = modo || datos.modo || "factura";
  const esPrefactura = tipo === "prefactura";
  const formato = config.formato_moneda || "cr";
  const ancho = Number(config.ancho_mm) === 58 ? 58 : 80;
  const cuerpo = ancho === 58 ? "52mm" : "74mm";
  const relleno = ancho === 58 ? "2mm 1.5mm 4mm" : "3mm 2mm 6mm";
  const fuente = Number(config.tamano_fuente) || 10;

  const lineas = datos.lineas || [];
  const sumaLineas = lineas.reduce((acc, l) => acc + Number(l.Subtotal || 0), 0);
  const cargos = (datos.cargos || []).map((c) => ({
    nombre: c.nombre || "",
    porcentaje: Number(c.porcentaje || 0),
    monto: c.monto !== undefined && c.monto !== null
      ? Number(c.monto)
      : montoCargo(sumaLineas, c.porcentaje)
  }));
  const sumaCargos = cargos.reduce((acc, c) => acc + Number(c.monto || 0), 0);
  const totalBase = datos.total !== undefined && datos.total !== null
    ? Number(datos.total)
    : sumaLineas + sumaCargos;

  const porcentaje = Number(config.impuesto_porcentaje || 0);
  const conImpuesto = si(config.mostrar_impuesto) && porcentaje > 0;
  let subtotal = totalBase;
  let impuesto = 0;
  let total = totalBase;
  if (conImpuesto) {
    if (si(config.impuesto_incluido)) {
      total = totalBase;
      impuesto = total - total / (1 + porcentaje / 100);
      subtotal = total - impuesto;
    } else {
      subtotal = totalBase;
      impuesto = subtotal * (porcentaje / 100);
      total = subtotal + impuesto;
    }
  }

  const mostrarCantidad = si(config.mostrar_cantidad);
  const mostrarUnitario = si(config.mostrar_precio_unitario);
  const mostrarSubtotalLinea = si(config.mostrar_subtotal_linea);
  const columnas = 1 + (mostrarCantidad ? 1 : 0) + (mostrarSubtotalLinea ? 1 : 0);

  const encabezado = [];
  if (si(config.mostrar_cedula) && config.cedula) encabezado.push("Cédula: " + config.cedula);
  if (si(config.mostrar_telefono) && config.telefono) encabezado.push("Tel: " + config.telefono);
  if (si(config.mostrar_direccion) && config.direccion) encabezado.push(config.direccion);
  if (si(config.mostrar_email) && config.email) encabezado.push(config.email);
  if (si(config.mostrar_sitio) && config.sitio_web) encabezado.push(config.sitio_web);
  lineasDeTexto(config.encabezado_extra).forEach((linea) => encabezado.push(linea));

  const meta = [];
  if (si(config.mostrar_numero) && datos.numero) meta.push(fila("No. Orden", "#" + datos.numero, "num"));
  if (si(config.mostrar_fecha) && datos.fecha) meta.push(fila("Fecha", datos.fecha, "num"));
  if (si(config.mostrar_hora) && datos.hora) meta.push(fila("Hora", datos.hora, "num"));
  if (si(config.mostrar_mesa) && datos.mesa) meta.push(fila("Mesa", datos.mesa, "texto"));
  if (si(config.mostrar_cliente) && datos.cliente) meta.push(fila("Cliente", datos.cliente, "texto"));
  if (si(config.mostrar_cajero) && datos.cajero) meta.push(fila("Atendido por", datos.cajero, "texto"));

  const filasItems = lineas.map((linea) => {
    const cantidadLinea = Number(linea.Cantidad) || 0;
    const guarniciones = guarnicionesTicket(linea);
    const totalGuarnicionesLinea = guarniciones.reduce(
      (acc, g) => acc + (Number(g.Precio) || 0) * cantidadLinea,
      0
    );
    // El importe del platillo no incluye las guarniciones: cada una se
    // muestra en su propia línea para que el cliente vea el desglose.
    const importeBaseLinea = Math.max(
      0,
      Number(linea.Subtotal || 0) - totalGuarnicionesLinea
    );
    const precioUnitarioBase =
      cantidadLinea > 0 ? importeBaseLinea / cantidadLinea : Number(linea.Precio || 0);

    const celdas = [];
    if (mostrarCantidad) celdas.push(`<td class="cant">${escapar(linea.Cantidad)}</td>`);
    const unitario = mostrarUnitario
      ? `<div class="unit">@ ${escapar(formatearMoneda(precioUnitarioBase, formato))}</div>`
      : "";
    celdas.push(`<td class="desc">${escapar(linea.Nombre)}${unitario}</td>`);
    if (mostrarSubtotalLinea) {
      celdas.push(`<td class="importe">${escapar(formatearMoneda(importeBaseLinea, formato))}</td>`);
    }
    let html = `<tr>${celdas.join("")}</tr>`;

    // Cada guarnición va en su propia fila: nombre a la izquierda y precio
    // alineado en la misma columna Importe, debajo del precio del platillo.
    guarniciones.forEach((g) => {
      const celdasGuarnicion = [];
      if (mostrarCantidad) celdasGuarnicion.push(`<td class="cant"></td>`);
      const montoGuarnicion = (Number(g.Precio) || 0) * cantidadLinea;
      const precioTexto = montoGuarnicion > 0
        ? formatearMoneda(montoGuarnicion, formato)
        : "";
      celdasGuarnicion.push(
        `<td class="desc guarn-desc">+ ${escapar(g.Nombre)}${
          mostrarSubtotalLinea ? "" : (precioTexto ? ` (${escapar(precioTexto)})` : "")
        }</td>`
      );
      if (mostrarSubtotalLinea) {
        celdasGuarnicion.push(`<td class="importe guarn-importe">${escapar(precioTexto)}</td>`);
      }
      html += `<tr class="guarn-fila">${celdasGuarnicion.join("")}</tr>`;
    });
    return html;
  }).join("");

  const totales = [];
  if (cargos.length > 0) {
    // Con cargos se muestra la base de las líneas y cada porcentaje aplicado
    totales.push(fila("Subtotal", formatearMoneda(sumaLineas, formato), "num"));
    cargos.forEach((cargo) => {
      totales.push(fila(
        cargo.nombre + " " + formatearPorcentaje(cargo.porcentaje) + "%",
        formatearMoneda(cargo.monto, formato),
        "num"
      ));
    });
  } else if (conImpuesto && si(config.mostrar_subtotal)) {
    totales.push(`<div class="fila"><span>Subtotal</span><span class="num">${escapar(formatearMoneda(subtotal, formato))}</span></div>`);
  }
  if (conImpuesto) {
    const etiquetaIva = si(config.impuesto_incluido)
      ? `IVA ${porcentaje}% (incluido)`
      : `IVA ${porcentaje}%`;
    totales.push(`<div class="fila"><span>${escapar(etiquetaIva)}</span><span class="num">${escapar(formatearMoneda(impuesto, formato))}</span></div>`);
  }
  totales.push(`<div class="fila total"><span>TOTAL</span><span class="num">${escapar(formatearMoneda(total, formato))}</span></div>`);

  const pagos = [];
  if (!esPrefactura && si(config.mostrar_pagos)) {
    (datos.pagos || []).forEach((pago) => {
      if (Number(pago.monto || 0) <= 0) return;
      pagos.push(`<div class="fila"><span>PAGO ${escapar(pago.metodo_pago)}</span>` +
        `<span class="num">${escapar(formatearMoneda(pago.monto, formato))}</span></div>`);
    });
  }
  const vuelto = (!esPrefactura && si(config.mostrar_vuelto) && Number(datos.vuelto || 0) > 0)
    ? `<div class="fila vuelto"><span>VUELTO</span><span class="num">${escapar(formatearMoneda(datos.vuelto, formato))}</span></div>`
    : "";

  const pie = lineasDeTexto(config.leyenda_pie)
    .map((linea) => `<p>${escapar(linea)}</p>`)
    .join("");

  // Chrome ignora "size: 80mm auto": hay que darle alto fijo.
  // Se estima el alto según el contenido para que quepa en una sola página.
  // La impresión real vuelve a medir el contenido, pero la estimación debe ser
  // generosa para que nunca se corte en dos páginas.
  const altoLineaMm = (fuente * 1.35) / 3.7795;
  const renglonesGuarniciones = lineas.reduce(
    (acc, linea) => acc + guarnicionesTicket(linea).length,
    0
  );
  const renglones =
    10 +
    encabezado.length +
    meta.length +
    lineas.length * (mostrarUnitario ? 4 : 3) +
    renglonesGuarniciones +
    totales.length +
    cargos.length +
    pagos.length +
    (vuelto ? 1 : 0) +
    (datos.nota ? 1 : 0) +
    lineasDeTexto(config.leyenda_pie).length +
    (esPrefactura ? 1 : 0);
  const alturaMm = Math.max(80, Math.ceil(renglones * altoLineaMm + 30));

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapar((esPrefactura ? config.etiqueta_prefactura : config.etiqueta_factura) + " " + (datos.numero || ""))}</title>
<style id="page-size">@page { size: ${ancho}mm ${alturaMm}mm; margin: 0; }</style>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${cuerpo};
    padding: ${relleno};
    font-family: Consolas, "Courier New", "Lucida Console", monospace;
    font-size: ${fuente}px;
    line-height: 1.35;
    color: #000;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .centro { text-align: center; }
  .negocio {
    font-size: 1.5em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin-bottom: 2px;
  }
  .dato { font-size: 0.92em; word-break: break-word; margin: 1px 0; }
  .nota { font-size: 0.9em; font-weight: 700; margin: 0 0 4px; }
  .sep { border-top: 1px dashed #000; margin: 5px 0; }
  .sep-fuerte { border-top: 1px solid #000; margin: 5px 0; }
  .etiqueta {
    display: inline-block;
    border: 1px solid #000;
    padding: 0 6px;
    font-weight: 700;
    letter-spacing: 0.12em;
    font-size: 0.95em;
  }
  .fila { display: flex; justify-content: space-between; gap: 6px; margin: 1px 0; }
  .fila .etq { flex: 0 0 auto; }
  .fila .val { flex: 1; text-align: right; }
  .fila .val.texto { word-break: break-word; }
  .num { white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.items { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.items th {
    font-size: 0.9em;
    text-align: left;
    border-bottom: 1px solid #000;
    padding-bottom: 2px;
    font-weight: 700;
  }
  table.items td { vertical-align: top; padding: 2px 0; }
  table.items .cant { width: 9mm; text-align: left; }
  table.items .importe { width: 20mm; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.items .desc { word-break: break-word; }
  table.items .unit { font-size: 0.85em; }
  table.items tr.guarn-fila td {
    padding-top: 1px;
    padding-bottom: 1px;
  }
  table.items .guarn-desc {
    padding-left: 4mm;
    font-size: 0.88em;
    text-align: left;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  table.items .guarn-importe {
    font-size: 0.88em;
    font-weight: 400;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .nom-sub { font-size: 0.8em; font-weight: 400; }
  .lin-sub { font-size: 0.8em; font-weight: 400; margin-left: 14px; }
  .total { font-size: 1.2em; font-weight: 700; }
  .vuelto { font-weight: 700; }
  .pie { text-align: center; margin-top: 8px; }
  .pie p { margin: 2px 0; word-break: break-word; }
  .pequeno { font-size: 0.85em; text-align: center; margin-top: 4px; }
</style>
</head>
<body>
  <div class="centro">
    <div class="negocio">${escapar(config.nombre_negocio)}</div>
    ${encabezado.map((linea) => `<div class="dato">${escapar(linea)}</div>`).join("")}
  </div>

  <div class="sep"></div>
  <div class="centro"><span class="etiqueta">${escapar(esPrefactura ? config.etiqueta_prefactura : config.etiqueta_factura)}</span></div>
  <div class="sep"></div>
  ${datos.nota ? `<div class="centro nota">${escapar(datos.nota)}</div>` : ""}
  ${meta.join("")}

  <div class="sep"></div>
  <table class="items">
    <colgroup>
      ${mostrarCantidad ? '<col style="width:9mm">' : ""}
      <col>
      ${mostrarSubtotalLinea ? '<col style="width:20mm">' : ""}
    </colgroup>
    <thead>
      <tr>
        ${mostrarCantidad ? '<th class="cant">Cant</th>' : ""}
        <th>Descripción</th>
        ${mostrarSubtotalLinea ? '<th class="importe" style="text-align:right">Importe</th>' : ""}
      </tr>
    </thead>
    <tbody>
      ${filasItems || `<tr><td colspan="${columnas}">Sin productos</td></tr>`}
    </tbody>
  </table>

  <div class="sep-fuerte"></div>
  ${totales.join("")}

  ${pagos.length > 0 || vuelto ? '<div class="sep"></div>' : ""}
  ${pagos.join("")}
  ${vuelto}

  ${pie ? '<div class="sep"></div><div class="pie">' + pie + "</div>" : ""}
  ${esPrefactura ? '<div class="pequeno">Documento informativo - no es comprobante fiscal</div>' : ""}
</body>
</html>`;
};

export const imprimirTicket = (html) =>
  new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("title", "ticket");
    // Fuera de pantalla (pero no oculto): así el navegador lo imprime y se puede medir
    iframe.style.cssText =
      "position:fixed;left:-10000px;top:0;width:120mm;height:1200mm;border:0;pointer-events:none;background:#fff;";
    document.body.appendChild(iframe);

    let terminado = false;
    const finalizar = () => {
      if (terminado) return;
      terminado = true;
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      resolve();
    };

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    iframe.contentWindow.onafterprint = finalizar;
    setTimeout(() => {
      try {
        // Ajusta el ancho/alto de la página al contenido real
        // (Chrome ignora "size: 80mm auto", hay que dar dos medidas)
        const cuerpo = doc.body;
        const estiloPagina = doc.getElementById("page-size");
        if (cuerpo && estiloPagina) {
          const pxPorMm = 3.7795275591;
          const anchoMm = Math.ceil(cuerpo.getBoundingClientRect().width / pxPorMm) + 6;
          const altoMm = Math.ceil(cuerpo.scrollHeight / pxPorMm) + 3;
          if (anchoMm > 0 && altoMm > 0) {
            estiloPagina.textContent =
              "@page { size: " + anchoMm + "mm " + altoMm + "mm; margin: 0; }";
            void cuerpo.offsetHeight;
          }
        }
        // Deja que el navegador aplique el nuevo tamaño antes de imprimir
        setTimeout(() => {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (e) {
            // si falla la impresión igual se limpia el iframe
          } finally {
            setTimeout(finalizar, 3000);
          }
        }, 200);
      } catch (e) {
        finalizar();
      }
    }, 400);
  });
