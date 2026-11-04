/**
 * ============================================================================
 * ARCHIVO: src/js/cierreReporte.js
 * PROPÓSITO: genera el HTML del reporte de cierre de caja para papel térmico.
 *
 * EXPORTS:
 *  - construirCierreHTML(cierre, configEntrada)  devuelve el documento completo
 *
 * USO:
 *  - cierre.js lo imprime con imprimirTicket() de ticket.js (iframe oculto).
 *  - Usa la MISMA configuración del ticket (ancho 80/58 mm, moneda, negocio).
 *
 * DATOS ESPERADOS (respuesta de GET /cierre/:id o POST /cierre/):
 *  { CierreID, fecha, usuario, desde, hasta, CantidadFacturas, Total,
 *    EfectivoRecibido, Vuelto, EfectivoNeto, EfectivoContado, Diferencia,
 *    Observaciones, Metodos: [{metodo_pago, cantidad, monto}],
 *    Facturas: [{FacturaID, Total, MesaID, NombreMesa, Cliente}] }
 * ============================================================================
 */
import { CONFIG_TICKET_DEFAULT, formatearMoneda } from "./ticket";

const escapar = (texto) =>
  String(texto === null || texto === undefined ? "" : texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fila = (etiqueta, valor, claseValor) => {
  if (valor === null || valor === undefined || String(valor).trim() === "") return "";
  return (
    `<div class="fila"><span class="etq">${escapar(etiqueta)}</span>` +
    `<span class="val ${claseValor || ""}">${escapar(valor)}</span></div>`
  );
};

const fechaHora = (valor) => {
  if (!valor) return "";
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(fecha.getTime())) return String(valor);
  return fecha.toLocaleString("es-CR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const mesaTexto = (factura) => {
  const mesa = factura.NombreMesa || factura.MesaID || "";
  const cliente = String(factura.Cliente || "").trim();
  return cliente ? `${mesa} · ${cliente}` : mesa;
};

export const construirCierreHTML = (cierre, configEntrada) => {
  const config = { ...CONFIG_TICKET_DEFAULT, ...(configEntrada || {}) };
  const formato = config.formato_moneda || "cr";
  const ancho = Number(config.ancho_mm) === 58 ? 58 : 80;
  const cuerpo = ancho === 58 ? "52mm" : "74mm";
  const relleno = ancho === 58 ? "2mm 1.5mm 4mm" : "3mm 2mm 6mm";
  const fuente = Number(config.tamano_fuente) || 10;

  const datos = cierre || {};
  const metodos = datos.Metodos || [];
  const facturas = datos.Facturas || [];
  const dinero = (valor) => formatearMoneda(valor, formato);

  const encabezado = [];
  if (Number(config.mostrar_cedula) === 1 && config.cedula) {
    encabezado.push("Cédula jurídica: " + config.cedula);
  }
  if (Number(config.mostrar_telefono) === 1 && config.telefono) {
    encabezado.push("Tel: " + config.telefono);
  }
  if (Number(config.mostrar_direccion) === 1 && config.direccion) {
    encabezado.push(config.direccion);
  }
  if (Number(config.mostrar_email) === 1 && config.email) {
    encabezado.push(config.email);
  }
  if (Number(config.mostrar_sitio) === 1 && config.sitio_web) {
    encabezado.push(config.sitio_web);
  }
  if (String(config.encabezado_extra || "").trim() !== "") {
    String(config.encabezado_extra)
      .split("\n")
      .map((linea) => linea.trim())
      .filter(Boolean)
      .forEach((linea) => encabezado.push(linea));
  }

  const filasMetodos = metodos
    .map((m) => {
      const nombre = String(m.metodo_pago || "").toUpperCase();
      const cantidad = Number(m.cantidad || 0);
      const etiqueta = cantidad > 0 ? `${nombre} (${cantidad})` : nombre;
      return fila(etiqueta, dinero(m.monto));
    })
    .join("");

  const filasFacturas = facturas
    .map((f) => {
      const numero = `#${f.FacturaID}`;
      return (
        `<tr><td class="cant">${escapar(numero)}</td>` +
        `<td class="desc">${escapar(mesaTexto(f))}</td>` +
        `<td class="importe">${escapar(dinero(f.Total))}</td></tr>`
      );
    })
    .join("");

  const periodo =
    datos.desde || datos.hasta
      ? `${fechaHora(datos.desde) || "-"}  →  ${fechaHora(datos.hasta) || "-"}`
      : "";

  const tieneDiferencia =
    datos.Diferencia !== null &&
    datos.Diferencia !== undefined &&
    datos.EfectivoContado !== null &&
    datos.EfectivoContado !== undefined;

  const observaciones = String(datos.Observaciones || "").trim();

  const renglones =
    18 +
    encabezado.length +
    filasFacturas.split("</tr>").length +
    metodos.length +
    (periodo ? 1 : 0) +
    2 +
    (tieneDiferencia ? 2 : 0) +
    (observaciones ? 3 : 0);
  const altoLineaMm = fuente * 0.45;
  const alturaMm = Math.max(100, Math.ceil(renglones * altoLineaMm + 40));

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Cierre de caja ${escapar(datos.CierreID || "")}</title>
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
    font-size: 1.45em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin-bottom: 2px;
  }
  .dato { font-size: 0.92em; word-break: break-word; margin: 1px 0; }
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
  .num { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sub { font-size: 0.85em; font-weight: 700; text-transform: uppercase; margin: 3px 0 2px; }
  table.items { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.items th {
    font-size: 0.9em;
    text-align: left;
    border-bottom: 1px solid #000;
    padding-bottom: 2px;
    font-weight: 700;
  }
  table.items td { vertical-align: top; padding: 2px 0; }
  table.items .cant { width: 15mm; text-align: left; }
  table.items .importe { width: 20mm; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.items .desc { word-break: break-word; }
  .total { font-size: 1.15em; font-weight: 700; }
  .diferencia { font-weight: 700; }
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
  <div class="centro"><span class="etiqueta">CIERRE DE CAJA</span></div>
  <div class="sep"></div>

  ${fila("Cierre #", datos.CierreID)}
  ${fila("Fecha", fechaHora(datos.fecha))}
  ${fila("Usuario", datos.usuario)}
  ${fila("Facturas", datos.CantidadFacturas)}
  ${periodo ? `<div class="fila"><span class="etq">Periodo</span><span class="val texto">${escapar(periodo)}</span></div>` : ""}

  <div class="sep"></div>
  <div class="sub">Facturas incluidas</div>
  <table class="items">
    <colgroup>
      <col style="width:15mm">
      <col>
      <col style="width:20mm">
    </colgroup>
    <thead>
      <tr>
        <th class="cant">Factura</th>
        <th>Mesa / Cliente</th>
        <th class="importe" style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${filasFacturas || '<tr><td colspan="3">Sin facturas</td></tr>'}
    </tbody>
  </table>

  <div class="sep-fuerte"></div>
  ${fila("Total facturas", dinero(datos.Total), "total")}

  <div class="sep"></div>
  <div class="sub">Métodos de pago</div>
  ${filasMetodos || fila("Sin pagos registrados", dinero(0))}

  <div class="sep"></div>
  <div class="sub">Efectivo</div>
  ${fila("Efectivo inicial", dinero(datos.EfectivoInicial))}
  ${fila("Efectivo recibido", dinero(datos.EfectivoRecibido))}
  ${fila("Vuelto entregado", dinero(datos.Vuelto))}
  ${fila("Efectivo neto de ventas", dinero(datos.EfectivoNeto))}
  ${fila("Efectivo esperado en caja", dinero(datos.EfectivoEsperado), "total")}
  ${
    datos.EfectivoContado !== null && datos.EfectivoContado !== undefined
      ? fila("Efectivo contado", dinero(datos.EfectivoContado))
      : ""
  }
  ${
    tieneDiferencia
      ? fila("Diferencia", dinero(datos.Diferencia), "diferencia")
      : ""
  }

  ${
    observaciones
      ? `<div class="sep"></div><div class="sub">Observaciones</div>` +
        observaciones
          .split("\n")
          .map((linea) => `<div class="dato">${escapar(linea)}</div>`)
          .join("")
      : ""
  }

  ${
    String(config.leyenda_pie || "").trim() !== ""
      ? '<div class="sep"></div><div class="pie">' +
        String(config.leyenda_pie)
          .split("\n")
          .map((linea) => `<p>${escapar(linea)}</p>`)
          .join("") +
        "</div>"
      : ""
  }
  <div class="pequeno">Reporte de cierre de caja</div>
</body>
</html>`;
};

export default construirCierreHTML;
