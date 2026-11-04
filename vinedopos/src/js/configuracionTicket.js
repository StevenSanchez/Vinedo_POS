/**
 * ============================================================================
 * ARCHIVO: src/js/configuracionTicket.js
 * PROPÓSITO: editor del "machote" del ticket (tabla configuracion_ticket).
 *
 * ENDPOINTS:
 *   GET /configuracion/ticket   cargar (vía obtenerConfigTicket)
 *   PUT /configuracion/ticket   guardar (solo columnas de CAMPOS_CONFIG_TICKET)
 *
 * CONTENIDO DEL FORMULARIO:
 *  - Datos del negocio: nombre, cédula, teléfono, dirección, email, sitio web.
 *  - Textos libres: encabezado extra y leyenda del pie.
 *  - Qué se imprime: checkboxes (fecha, hora, mesa, cliente, cajero, número,
 *    cantidad, precio unitario, subtotal, impuesto, pagos, vuelto...).
 *  - Impuesto: porcentaje y si está incluido en los precios.
 *  - Etiquetas de prefactura/factura y formato (ancho 58/80 mm, fuente, moneda).
 *
 * VISTA PREVIA:
 *  - iframe con srcDoc que usa el MISMO construirTicketHTML y datos de prueba.
 *  - Pestañas "Factura pagada" / "Prefactura".
 *  - "Imprimir prueba" usa la configuración actual del formulario.
 *  - "Restaurar" vuelve a CONFIG_TICKET_DEFAULT solo en el formulario;
 *    hay que Guardar para persistir.
 *
 * IMPORTANTE: si se agrega un campo nuevo a la tabla, también hay que sumarlo
 * a CONFIG_TICKET_DEFAULT (ticket.js) y a CAMPOS_CONFIG_TICKET (api/routes.js).
 * ============================================================================
 */
import React from "react";
import "../css/crud.css";
import { Navbar, Nav, Container } from "react-bootstrap";
import axios from "axios";
import Cookies from "universal-cookie";
import Swal from "sweetalert2";
import { ruta } from "../Ruta/ruta";
import {
  CONFIG_TICKET_DEFAULT,
  construirTicketHTML,
  fechaHoraActual,
  imprimirTicket,
  obtenerConfigTicket,
  si
} from "./ticket";
import logo from "../images/logo.png";

const baseUrl = ruta.baseUrl;
const cookies = new Cookies();

const datosPrueba = () => {
  const { fecha, hora } = fechaHoraActual();
  return {
    numero: 128,
    fecha,
    hora,
    mesa: "Mesa 1",
    cliente: "Cliente de ejemplo",
    cajero: "cajero",
    lineas: [
      { Nombre: "Lomito", Cantidad: 2, Precio: 8000, Subtotal: 16000 },
      { Nombre: "Parrillada", Cantidad: 1, Precio: 16000, Subtotal: 16000 }
    ],
    total: 32000,
    pagos: [{ metodo_pago: "EFECTIVO", monto: 40000 }],
    vuelto: 8000,
    modo: "factura"
  };
};

class configuracionTicket extends React.Component {
  state = {
    config: { ...CONFIG_TICKET_DEFAULT },
    vistaModo: "factura",
    cargando: true,
    guardando: false
  };

  componentDidMount() {
    if (!cookies.get("idUsuario")) {
      window.location.href = "/login";
      return;
    }
    this.cargar();
  }

  cargar = async () => {
    const config = await obtenerConfigTicket();
    this.setState({ config, cargando: false });
  };

  handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let nuevo = type === "checkbox" ? (checked ? 1 : 0) : value;
    if (["ancho_mm", "tamano_fuente", "impuesto_porcentaje"].includes(name)) {
      nuevo = value === "" ? "" : Number(value);
    }
    this.setState({ config: { ...this.state.config, [name]: nuevo } });
  };

  guardar = async () => {
    const { config } = this.state;
    if (!config.nombre_negocio || String(config.nombre_negocio).trim() === "") {
      Swal.fire("Falta el nombre", "El nombre del negocio no puede quedar vacío.", "warning");
      return;
    }
    this.setState({ guardando: true });
    try {
      await axios.put(baseUrl + "configuracion/ticket", config);
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Machote guardado",
        showConfirmButton: false,
        timer: 1800
      });
    } catch (e) {
      Swal.fire("Error", "No se pudo guardar la configuración.", "error");
    } finally {
      this.setState({ guardando: false });
    }
  };

  restaurar = async () => {
    const res = await Swal.fire({
      title: "¿Restaurar valores por defecto?",
      text: "Se perderán los textos que hayas escrito en este formulario.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Restaurar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#dc3545",
      cancelButtonColor: "#6c757d"
    });
    if (res.isConfirmed) {
      this.setState({ config: { ...CONFIG_TICKET_DEFAULT } });
    }
  };

  imprimirPrueba = () => {
    const html = construirTicketHTML(datosPrueba(), this.state.config, this.state.vistaModo);
    imprimirTicket(html);
  };

  check = (campo, etiqueta) => (
    <label className="ticket-check" key={campo}>
      <input
        type="checkbox"
        name={campo}
        checked={si(this.state.config[campo])}
        onChange={this.handleChange}
      />
      <span>{etiqueta}</span>
    </label>
  );

  cerrarSesion = () => {
    cookies.remove("idUsuario", { path: "/" });
    cookies.remove("usuario", { path: "/" });
    window.location.href = "/login";
  };

  render() {
    const { config, vistaModo } = this.state;
    const html = construirTicketHTML(datosPrueba(), config, vistaModo);

    return (
      <div className="App-body">
        <div>
          <Navbar collapseOnSelect expand="lg" bg="dark" variant="dark">
            <Container>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button className="btnNavbar" onClick={() => { window.location.href = "/administracion" }} style={{ padding: "0.3rem 0.7rem" }}>
                  <i className="bi bi-arrow-left"></i> Volver
                </button>
                <Navbar.Brand href="/administracion" className="d-flex align-items-center gap-2">
                  <img src={logo} alt="Logo ViñedoPos" width="35" height="35" className="d-inline-block align-top" />
                  <span>VinedoPos</span>
                </Navbar.Brand>
              </div>
              <Navbar.Toggle aria-controls="responsive-navbar-nav" />
              <Navbar.Collapse id="responsive-navbar-nav">
                <Nav className="me-auto">
                  <Nav.Link href="/administracion"><button className="btnNavbar">Administración</button></Nav.Link>
                  <Nav.Link href="/mesas"><button className="btnNavbar">Mesas</button></Nav.Link>
                </Nav>
                <Nav>
                  <Nav.Link>
                    <button className="btnNavbar" onClick={() => this.cerrarSesion()}>Cerrar sesión</button>
                  </Nav.Link>
                </Nav>
              </Navbar.Collapse>
            </Container>
          </Navbar>
        </div>

        <div className="crud-container">
          <div className="ticket-config">
            <div className="ticket-form">
              <h2>Ticket / Factura</h2>
              <p className="ticket-ayuda">
                Todo lo que escribas aquí sale impreso. La vista previa de la derecha es exactamente lo que se imprime.
              </p>

              <h4>Datos del negocio</h4>
              <div className="ticket-campo">
                <label>Nombre del negocio</label>
                <input type="text" name="nombre_negocio" value={config.nombre_negocio || ""} onChange={this.handleChange} />
              </div>
              <div className="ticket-fila">
                <div className="ticket-campo">
                  <label>Cédula</label>
                  <input type="text" name="cedula" value={config.cedula || ""} onChange={this.handleChange} />
                </div>
                <div className="ticket-campo">
                  <label>Teléfono</label>
                  <input type="text" name="telefono" value={config.telefono || ""} onChange={this.handleChange} />
                </div>
              </div>
              <div className="ticket-campo">
                <label>Dirección</label>
                <textarea name="direccion" rows="2" value={config.direccion || ""} onChange={this.handleChange} />
              </div>
              <div className="ticket-fila">
                <div className="ticket-campo">
                  <label>Correo (opcional)</label>
                  <input type="text" name="email" value={config.email || ""} onChange={this.handleChange} />
                </div>
                <div className="ticket-campo">
                  <label>Sitio web / redes (opcional)</label>
                  <input type="text" name="sitio_web" value={config.sitio_web || ""} onChange={this.handleChange} />
                </div>
              </div>
              <div className="ticket-campo">
                <label>Líneas libres debajo del encabezado</label>
                <textarea name="encabezado_extra" rows="2" value={config.encabezado_extra || ""} onChange={this.handleChange} placeholder="Una línea por renglón. Ej: Reservas 8888-8888" />
              </div>

              <h4>Qué se imprime</h4>
              <div className="ticket-checks">
                {this.check("mostrar_cedula", "Cédula")}
                {this.check("mostrar_telefono", "Teléfono")}
                {this.check("mostrar_direccion", "Dirección")}
                {this.check("mostrar_email", "Correo")}
                {this.check("mostrar_sitio", "Sitio web")}
                {this.check("mostrar_numero", "N° de orden")}
                {this.check("mostrar_fecha", "Fecha")}
                {this.check("mostrar_hora", "Hora")}
                {this.check("mostrar_mesa", "Mesa")}
                {this.check("mostrar_cliente", "Cliente")}
                {this.check("mostrar_cajero", "Cajero")}
                {this.check("mostrar_cantidad", "Cantidad")}
                {this.check("mostrar_precio_unitario", "Precio unitario")}
                {this.check("mostrar_subtotal_linea", "Importe por línea")}
                {this.check("mostrar_pagos", "Desglose de pagos")}
                {this.check("mostrar_vuelto", "Vuelto")}
              </div>

              <h4>Impuestos</h4>
              <div className="ticket-checks">
                {this.check("mostrar_impuesto", "Mostrar desglose de impuesto")}
                {this.check("mostrar_subtotal", "Mostrar subtotal (sin impuesto)")}
                {this.check("impuesto_incluido", "Los precios ya incluyen el impuesto")}
              </div>
              <div className="ticket-campo" style={{ maxWidth: "200px" }}>
                <label>Porcentaje de impuesto</label>
                <input type="number" step="0.01" min="0" name="impuesto_porcentaje" value={config.impuesto_porcentaje} onChange={this.handleChange} />
              </div>

              <h4>Textos</h4>
              <div className="ticket-fila">
                <div className="ticket-campo">
                  <label>Etiqueta de prefactura</label>
                  <input type="text" name="etiqueta_prefactura" value={config.etiqueta_prefactura || ""} onChange={this.handleChange} />
                </div>
                <div className="ticket-campo">
                  <label>Etiqueta de factura pagada</label>
                  <input type="text" name="etiqueta_factura" value={config.etiqueta_factura || ""} onChange={this.handleChange} />
                </div>
              </div>
              <div className="ticket-campo">
                <label>Pie de página</label>
                <textarea name="leyenda_pie" rows="3" value={config.leyenda_pie || ""} onChange={this.handleChange} placeholder="Una línea por renglón" />
              </div>

              <h4>Formato</h4>
              <div className="ticket-fila">
                <div className="ticket-campo">
                  <label>Ancho del papel</label>
                  <select name="ancho_mm" value={config.ancho_mm} onChange={this.handleChange}>
                    <option value={80}>80 mm (estándar)</option>
                    <option value={58}>58 mm (angosto)</option>
                  </select>
                </div>
                <div className="ticket-campo">
                  <label>Tamaño de letra (px)</label>
                  <input type="number" min="8" max="14" name="tamano_fuente" value={config.tamano_fuente} onChange={this.handleChange} />
                </div>
                <div className="ticket-campo">
                  <label>Formato de moneda</label>
                  <select name="formato_moneda" value={config.formato_moneda} onChange={this.handleChange}>
                    <option value="cr">₡10.000,00</option>
                    <option value="us">₡10,000.00</option>
                    <option value="plano">10000</option>
                  </select>
                </div>
              </div>

              <div className="ticket-botones">
                <button className="btn btn-success" onClick={this.guardar} disabled={this.state.guardando}>
                  <i className="bi bi-save"></i> {this.state.guardando ? "Guardando..." : "Guardar"}
                </button>
                <button className="btn btn-primary" onClick={this.imprimirPrueba}>
                  <i className="bi bi-printer"></i> Imprimir prueba
                </button>
                <button className="btn btn-outline-secondary" onClick={this.restaurar}>
                  <i className="bi bi-arrow-counterclockwise"></i> Restaurar
                </button>
              </div>
            </div>

            <div className="ticket-preview-col">
              <div className="ticket-preview-head">
                <h4>Vista previa</h4>
                <div className="ticket-tabs">
                  <button
                    className={vistaModo === "factura" ? "activo" : ""}
                    onClick={() => this.setState({ vistaModo: "factura" })}
                  >
                    Factura pagada
                  </button>
                  <button
                    className={vistaModo === "prefactura" ? "activo" : ""}
                    onClick={() => this.setState({ vistaModo: "prefactura" })}
                  >
                    Prefactura
                  </button>
                </div>
              </div>
              <iframe
                title="Vista previa del ticket"
                className="ticket-preview"
                srcDoc={html}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default configuracionTicket;
