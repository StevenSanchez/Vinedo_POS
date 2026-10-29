/**
 * ============================================================================
 * ARCHIVO: src/js/facturas.js
 * PROPÓSITO: histórico de facturas (abiertas y cerradas): listar, ver detalle,
 * reimprimir y borrar.
 *
 * ENDPOINTS:
 *   GET  /facturas/lista?estado=todas|abiertas|cerradas
 *   GET  /facturas/detalle/:id   -> { cabecera, lineas, pagos, cargos }
 *   POST /facturas/eliminar      -> borra líneas, pagos, cargos y factura
 *
 * COMPORTAMIENTO:
 *  - Filtro por estado + buscador por PREFIJO de FacturaID (solo en cliente
 *    y dentro del filtro activo).
 *  - Reimprimir: si estado === 1 imprime PREFACTURA; si está cerrada, FACTURA.
 *    Usa el mismo generador (ticket.js) y la configuración ACTUAL del machote.
 *  - Eliminar pide confirmación en un modal; es DEFINITIVO y se permite tanto
 *    en abiertas como en cerradas (decisión del negocio).
 * ============================================================================
 */
import React from "react";
import "../css/crud.css";
import { Navbar, Nav, Container } from "react-bootstrap";
import axios from "axios";
import Cookies from "universal-cookie";
import { Button, Modal, ModalBody, ModalHeader } from "reactstrap";
import { ruta } from "../Ruta/ruta";
import { construirTicketHTML, datosDesdeDetalle, imprimirTicket, obtenerConfigTicket } from "./ticket";
import logo from "../images/logo.png"
const baseUrl = ruta.baseUrl;
const cookies = new Cookies();

class facturas extends React.Component {
state = {
    facturas: [],
    filtro: "todas",
    busqueda: "", // Búsqueda unificada: Nº factura, cliente o mesa
    fechaDesde: "",
    fechaHasta: "",
    modalDetalle: false,
    modalBorradoMasivo: false,
    bmAplicarA: "cerradas",
    bmPreview: null,
    bmPreviewCargando: false,
    bmConfirmCheck: false,
    bmConfirmTexto: "",
    bmEliminando: false,
    modalMsg: false,
    modalConfirm: false,
    facturaAEliminar: null,
    msjModal: "",
    detalle: { cabecera: null, lineas: [], pagos: [], cargos: [] }
  };

  handleBusqueda = (e) => {
    this.setState({ busqueda: e.target.value });
  };

  handleFechaDesde = (e) => {
    this.setState({ fechaDesde: e.target.value });
  };

  handleFechaHasta = (e) => {
    this.setState({ fechaHasta: e.target.value });
  };

  limpiarFiltrosFechas = () => {
    this.setState({ fechaDesde: "", fechaHasta: "" });
  };

  abrirModalBorradoMasivo = () => {
    this.setState({
      modalBorradoMasivo: true,
      bmAplicarA: "cerradas",
      bmPreview: null,
      bmPreviewCargando: false,
      bmConfirmCheck: false,
      bmConfirmTexto: "",
      bmEliminando: false
    });
  };

  cerrarModalBorradoMasivo = () => {
    this.setState({
      modalBorradoMasivo: false,
      bmPreview: null,
      bmPreviewCargando: false,
      bmConfirmCheck: false,
      bmConfirmTexto: "",
      bmEliminando: false
    });
  };

  cambiarBmAplicarA = (e) => {
    this.setState({ bmAplicarA: e.target.value, bmPreview: null, bmConfirmCheck: false, bmConfirmTexto: "" });
  };

  previewBorradoMasivo = async () => {
    if (!this.state.fechaDesde || !this.state.fechaHasta) {
      this.setState({ modalMsg: true, msjModal: "Debe seleccionar fecha Desde y Hasta" });
      return;
    }
    this.setState({ bmPreviewCargando: true, bmPreview: null, bmConfirmCheck: false, bmConfirmTexto: "" });
    try {
      const res = await axios.post(baseUrl + "facturas/eliminar/por-fechas/preview", {
        fechaDesde: this.state.fechaDesde,
        fechaHasta: this.state.fechaHasta,
        aplicarA: this.state.bmAplicarA
      });
      this.setState({ bmPreview: res.data, bmPreviewCargando: false });
    } catch (e) {
      this.setState({ bmPreviewCargando: false, modalMsg: true, msjModal: e.response && e.response.data && e.response.data.error ? e.response.data.error : "Error al obtener vista previa" });
    }
  };

  toggleBmConfirmCheck = (e) => {
    this.setState({ bmConfirmCheck: e.target.checked });
  };

  cambiarBmConfirmTexto = (e) => {
    this.setState({ bmConfirmTexto: e.target.value });
  };

  ejecutarBorradoMasivo = async () => {
    if (!this.state.fechaDesde || !this.state.fechaHasta) {
      this.setState({ modalMsg: true, msjModal: "Debe seleccionar fecha Desde y Hasta" });
      return;
    }
    if (!this.state.bmConfirmCheck || this.state.bmConfirmTexto.trim().toUpperCase() !== "ELIMINAR") {
      this.setState({ modalMsg: true, msjModal: "Confirme marcando la casilla y escribiendo ELIMINAR" });
      return;
    }
    this.setState({ bmEliminando: true });
    try {
      const res = await axios.post(baseUrl + "facturas/eliminar/por-fechas", {
        fechaDesde: this.state.fechaDesde,
        fechaHasta: this.state.fechaHasta,
        aplicarA: this.state.bmAplicarA,
        confirmarCheck: true,
        confirmarTexto: "ELIMINAR"
      });
      this.setState({
        bmEliminando: false,
        modalBorradoMasivo: false,
        bmPreview: null,
        bmConfirmCheck: false,
        bmConfirmTexto: "",
        modalMsg: true,
        msjModal: `Se eliminaron ${res.data && res.data.eliminadas ? res.data.eliminadas : 0} facturas correctamente`
      });
      this.obtenerFacturas();
    } catch (e) {
      this.setState({ bmEliminando: false, modalMsg: true, msjModal: e.response && e.response.data && e.response.data.error ? e.response.data.error : "Error al eliminar por fechas" });
    }
  };

  componentDidMount() {
    if (!cookies.get("idUsuario")) {
      window.location.href = "/login";
    } else {
      this.obtenerFacturas();
    }
  }

  formatearFecha = (fecha) => {
    if (!fecha) return "-";
    try {
      const d = new Date(fecha);
      if (isNaN(d.getTime())) return fecha;
      return d.toLocaleString();
    } catch (e) {
      return fecha;
    }
  };

  parsearFechaLocal = (fecha) => {
    if (!fecha) return null;
    try {
      // Intentar extraer fecha ISO o fecha del listado
      if (typeof fecha === "string" && fecha.includes("T")) {
        const d = new Date(fecha);
        if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      }
      if (typeof fecha === "string") {
        // Intentar parsear formatos comunes (dd/mm/yyyy o yyyy-mm-dd)
        const m1 = fecha.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m1) {
          return new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]));
        }
        const m2 = fecha.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (m2) {
          return new Date(Number(m2[3]), Number(m2[2]) - 1, Number(m2[1]));
        }
      }
      const d = new Date(fecha);
      if (isNaN(d.getTime())) return null;
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    } catch (e) {
      return null;
    }
  };

  obtenerFechaFiltro = (f) => {
    // Para cerradas filtrar por fecha_cierre; para abiertas por fecha/creación; para todas usar lo más adecuado
    if (this.state.filtro === "cerradas") {
      return this.parsearFechaLocal(f.fecha_cierre);
    }
    if (this.state.filtro === "abiertas") {
      return this.parsearFechaLocal(f.Fecha || f.fecha_creacion || f.Hora);
    }
    // todas: priorizar fecha_cierre si existe, sino fecha de creación
    return this.parsearFechaLocal(f.fecha_cierre || f.Fecha || f.fecha_creacion || f.Hora);
  };

  obtenerFacturas = async () => {
    try {
      const res = await axios.get(baseUrl + "facturas/lista?estado=" + this.state.filtro);
      this.setState({ facturas: Array.isArray(res.data) ? res.data : [] });
    } catch (e) {
      this.setState({ facturas: [] });
    }
  };

  cambiarFiltro = (filtro) => {
    this.setState({ filtro: filtro }, this.obtenerFacturas);
  };

  verDetalle = async (f) => {
    try {
      const res = await axios.get(baseUrl + "facturas/detalle/" + f.FacturaID);
      this.setState({ detalle: res.data || { cabecera: null, lineas: [], pagos: [] }, modalDetalle: true }, () => {
        console.log("detalle cargado", this.state.detalle);
      });
    } catch (e) {
      this.setState({ modalMsg: true, msjModal: "Error al cargar detalle" });
    }
  };

  cerrarDetalle = () => {
    this.setState({ modalDetalle: false });
  };

// 1. Abre el modal pidiendo confirmación
  confirmarEliminacion = (facturaId) => {
    this.setState({
      modalConfirm: true,
      facturaAEliminar: facturaId
    });
  };

  // 2. Cierra el modal si el usuario cancela
  cancelarEliminacion = () => {
    this.setState({
      modalConfirm: false,
      facturaAEliminar: null
    });
  };

  // 3. Ejecuta el borrado al presionar "Eliminar" en el modal
  eliminarFactura = async () => {
    const { facturaAEliminar } = this.state;
    if (!facturaAEliminar) return;

    try {
      await axios.post(baseUrl + "facturas/eliminar", { FacturaID: facturaAEliminar });
      this.setState({ 
        modalConfirm: false,
        facturaAEliminar: null,
        modalMsg: true, 
        msjModal: `Factura #${facturaAEliminar} eliminada correctamente` 
      });
      this.obtenerFacturas();
    } catch (e) {
      this.setState({ 
        modalConfirm: false,
        facturaAEliminar: null,
        modalMsg: true, 
        msjModal: "Error al eliminar la factura" 
      });
    }
  };

  reimprimir = async (f) => {
    try {
      const [res, config] = await Promise.all([
        axios.get(baseUrl + "facturas/detalle/" + f.FacturaID),
        obtenerConfigTicket()
      ]);
      const detalle = res.data || { cabecera: null, lineas: [], pagos: [] };
      const abierta = detalle.cabecera && Number(detalle.cabecera.estado) === 1;
      const modo = abierta ? "prefactura" : "factura";
      const html = construirTicketHTML(datosDesdeDetalle(detalle, modo), config, modo);
      await imprimirTicket(html);
      this.setState({ modalMsg: true, msjModal: "Ticket enviado a impresión" });
    } catch (e) {
      this.setState({ modalMsg: true, msjModal: "Error al reimprimir" });
    }
  };

  cerrarMsg = () => {
    this.setState({ modalMsg: false });
  };

  cerrarSesion = () => {
    cookies.remove("idUsuario", { path: "/" });
    cookies.remove("usuario", { path: "/" });
    window.location.href = "/login";
  };

  render() {
    const { cabecera, lineas, pagos, cargos } = this.state.detalle;
    return (
      <div className="App-body">
        <div>
          <Navbar collapseOnSelect expand="lg" bg="dark" variant="dark">
            <Container>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                 <button id="btNavbar" onClick={() => { window.location.href = "/administracion" }} style={{ padding: "0.3rem 0.7rem" }}>
                  <i className="bi bi-arrow-left"></i> Volver</button>
                  <Navbar.Brand href="/mesas" className="d-flex align-items-center gap-2">
                    <img
                      src={logo}
                      alt="Logo ViñedoPos"
                      width="35"
                      height="35"
                      className="d-inline-block align-top"
                    />
                    <span>VinedoPos</span>
                  </Navbar.Brand>
              </div>
              <Navbar.Toggle aria-controls="responsive-navbar-nav" />
              <Navbar.Collapse id="responsive-navbar-nav">
                <Nav className="me-auto">
                  <Nav.Link href="/administracion">
                    <button id="btNavbar">Administración</button>
                  </Nav.Link>
                  <Nav.Link href="/mesas">
                    <button id="btNavbar">Mesas</button>
                  </Nav.Link>
                </Nav>
                <Nav>
                  <Nav.Link>
                    <button id="btNavbar" onClick={() => this.cerrarSesion()}>Cerrar sesión</button>
                  </Nav.Link>
                </Nav>
              </Navbar.Collapse>
            </Container>
          </Navbar>
        </div>

        <div className="crud-container">
          <div className="TablaDatos" style={{ maxWidth: "1100px" }}>
            <h2>Facturas</h2>
            <div 
              style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center", 
                marginTop: "15px", 
                flexWrap: "wrap",
                gap: "15px" 
              }}
            >
              {/* Espaciador izquierdo para equilibrar en pantallas anchas */}
              <div style={{ flex: 1, minWidth: "200px" }}></div>

              {/* Botones de filtro de estado (Centro) */}
            <div className="contenedor-filtros">
              {/* Botones de filtro (Centro) */}
              <div className="grupo-botones">
                <Button 
                  color={this.state.filtro === "todas" ? "primary" : "secondary"} 
                  onClick={() => this.cambiarFiltro("todas")}
                >
                  Todas
                </Button>
                <Button 
                  color={this.state.filtro === "abiertas" ? "primary" : "secondary"} 
                  onClick={() => this.cambiarFiltro("abiertas")}
                >
                  Abiertas
                </Button>
                <Button 
                  color={this.state.filtro === "cerradas" ? "primary" : "secondary"} 
                  onClick={() => this.cambiarFiltro("cerradas")}
                >
                  Cerradas
                </Button>
              </div>

              {/* Buscador unificado (Nº factura, cliente o mesa) */}
              <div className="grupo-buscador">
                <div className="input-group" style={{ maxWidth: "260px", width: "100%" }}>
                  <span className="input-group-text bg-white border-end-0">
                    <i className="bi bi-search text-muted"></i>
                  </span>
                  <input
                    type="text"
                    className="form-control border-start-0"
                    placeholder="Factura, cliente o mesa"
                    value={this.state.busqueda}
                    onChange={this.handleBusqueda}
                  />
                </div>
              </div>
            </div>

            </div>

            <div 
              style={{ 
                display: "flex", 
                justifyContent: "center", 
                alignItems: "center", 
                marginTop: "10px", 
                flexWrap: "wrap",
                gap: "10px" 
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.9rem", color: "#555" }}>Desde</span>
                <input
                  type="date"
                  className="form-control"
                  style={{ width: "170px" }}
                  value={this.state.fechaDesde}
                  onChange={this.handleFechaDesde}
                />
                <span style={{ fontSize: "0.9rem", color: "#555" }}>Hasta</span>
                <input
                  type="date"
                  className="form-control"
                  style={{ width: "170px" }}
                  value={this.state.fechaHasta}
                  onChange={this.handleFechaHasta}
                />
                {(this.state.fechaDesde || this.state.fechaHasta) && (
                  <Button size="sm" color="secondary" outline onClick={this.limpiarFiltrosFechas}>
                    Limpiar fechas
                  </Button>
                )}
                <span style={{ fontSize: "0.8rem", color: "#6c757d" }}>
                  {this.state.filtro === "cerradas" ? "Filtra por fecha de cierre" : this.state.filtro === "abiertas" ? "Filtra por fecha de creación" : "Filtra por fecha (cierre o creación)"}
                </span>
                <Button size="sm" color="danger" onClick={this.abrirModalBorradoMasivo}>
                  <i className="bi bi-trash3 me-1"></i> Borrar por fechas
                </Button>
              </div>
            </div>
            <div className="table-responsive" style={{ marginTop: "20px" }}>
              <table className="table table-hover table-sm">
                <thead className="thead-dark">
                  <tr>
                    <th>#Factura</th>
                    <th>Mesa</th>
                    <th>Fecha Creación</th>
                    <th>Fecha Cierre</th>
                    <th>Total</th>
                    <th>Estado</th>
                    <th>Cobrado por</th>
                    <th>Detalle</th>
                    <th>Reimprimir</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                {(() => {
                  const facturasFiltradas = (Array.isArray(this.state.facturas) ? this.state.facturas : [])
                    .filter((f) => {
                      const busq = this.state.busqueda.trim().toLowerCase();
                      if (busq) {
                        const idStr = String(f.FacturaID || "").toLowerCase();
                        const cliente = String(f.Cliente || "").toLowerCase();
                        const mesa = String(f.MesaNombre || f.NombreMesa || f.MesaID || "").toLowerCase();
                        const coincideBusqueda = idStr.includes(busq) || cliente.includes(busq) || mesa.includes(busq);
                        if (!coincideBusqueda) return false;
                      }
                      const fechaFiltro = this.obtenerFechaFiltro(f);
                      if (fechaFiltro) {
                        if (this.state.fechaDesde) {
                          const desde = new Date(this.state.fechaDesde + "T00:00:00");
                          if (fechaFiltro < new Date(desde.getFullYear(), desde.getMonth(), desde.getDate())) return false;
                        }
                        if (this.state.fechaHasta) {
                          const hasta = new Date(this.state.fechaHasta + "T00:00:00");
                          if (fechaFiltro > new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate())) return false;
                        }
                      }
                      return true;
                    });

                  const sumaTotal = facturasFiltradas.reduce((acc, f) => acc + Number(f.Total || 0), 0);
                  const sumaBase = facturasFiltradas.reduce((acc, f) => acc + Number(f.Base || 0), 0);
                  const sumaCargos = facturasFiltradas.reduce((acc, f) => acc + Number(f.Cargos || 0), 0);

                  return (
                    <>
                      {facturasFiltradas.map((f, index) => (
                        <tr key={index}>
                          <td>{f.FacturaID}</td>
                          <td>{f.MesaNombre || "-"}</td>
                          <td>{f.Hora && f.Fecha ? f.Fecha + " " + f.Hora : this.formatearFecha(f.Fecha || f.Hora || f.fecha_creacion)}</td>
                          <td>{this.formatearFecha(f.fecha_cierre)}</td>
                          <td>₡ {f.Total}</td>
                          <td>{f.estado === 1 ? "Abierta" : "Cerrada"}</td>
                          <td>{f.UsuarioCobro || "-"}</td>
                          <td>
                            <Button size="sm" color="outline-secondary" type="button" onClick={() => this.verDetalle(f)}>
                              <i className="bi bi-eye"></i>
                            </Button>
                          </td>
                          <td>
                            <Button size="sm" color="outline-secondary" onClick={() => this.reimprimir(f)} title={f.estado === 1 ? "Imprimir prefactura" : "Reimprimir ticket"}>
                              <i className="bi bi-printer"></i>
                            </Button>
                          </td>
                          <td>
                            <Button size="sm" color="outline-danger" type="button" onClick={() => this.confirmarEliminacion(f.FacturaID)}>
                              <i className="bi bi-trash"></i>
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {facturasFiltradas.length > 0 && (
                        <tr style={{ backgroundColor: "#f8f9fa", fontWeight: "bold" }}>
                          <td colSpan="4">Totales ({facturasFiltradas.length} resultado{facturasFiltradas.length === 1 ? "" : "s"})</td>
                          <td>₡ {sumaTotal.toLocaleString("es-CR")}</td>
                          <td colSpan="5">
                            {sumaBase > 0 || sumaCargos > 0 ? (
                              <span style={{ fontSize: "0.85rem" }}>
                                Base: ₡ {sumaBase.toLocaleString("es-CR")} | Cargos: ₡ {sumaCargos.toLocaleString("es-CR")}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      )}
                      {facturasFiltradas.length === 0 && (
                        <tr>
                          <td colSpan="10" style={{ textAlign: "center", color: "#6c757d" }}>
                            No hay facturas que coincidan con los filtros
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })()}
              </tbody>
              </table>
            </div>
          </div>
        </div>

        <Modal isOpen={this.state.modalDetalle} size="lg" toggle={this.cerrarDetalle}>
          <ModalHeader>
            <div>
              <h3 style={{ color: "black" }}>Detalle Factura #{cabecera ? cabecera.FacturaID : ""}</h3>
            </div>
          </ModalHeader>
          <ModalBody>
            {cabecera && (
              <div>
                <p><strong>Mesa:</strong> {cabecera.MesaNombre || "-"}</p>
                <p><strong>Estado:</strong> {cabecera.estado === 1 ? "Abierta" : "Cerrada"}</p>
                <p><strong>Fecha Creación:</strong> {cabecera.Hora && cabecera.Fecha ? cabecera.Fecha + " " + cabecera.Hora : this.formatearFecha(cabecera.Fecha || cabecera.Hora)}</p>
                <p><strong>Fecha Cierre:</strong> {this.formatearFecha(cabecera.fecha_cierre)}</p>
                <p><strong>Cobrado por:</strong> {cabecera.UsuarioCobro || "-"}</p>
                <p><strong>Total:</strong> ₡ {cabecera.Total}</p>
                <p><strong>Vuelto:</strong> ₡ {cabecera.vuelto || 0}</p>
                <hr />
                <h5>Productos</h5>
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Cantidad</th>
                      <th>Precio</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineas.map((l, i) => (
                      <tr key={i}>
                        <td>{l.Nombre}</td>
                        <td>{l.Cantidad}</td>
                        <td>₡ {l.Precio}</td>
                        <td>₡ {l.Subtotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(cargos || []).length > 0 && (
                  <div>
                    <hr />
                    <h5>Cargos / Servicio</h5>
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>Cargo</th>
                          <th>Porcentaje</th>
                          <th>Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(cargos || []).map((c, i) => (
                          <tr key={i}>
                            <td>{c.nombre}</td>
                            <td>{c.porcentaje}%</td>
                            <td>₡ {c.monto}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <hr />
                <h5>Pagos</h5>
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Método</th>
                      <th>Monto</th>
                      <th>Referencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagos.map((p, i) => (
                      <tr key={i}>
                        <td>{p.metodo_pago}</td>
                        <td>₡ {p.monto}</td>
                        <td>{p.referencia || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Button onClick={this.cerrarDetalle}>Cerrar</Button>
          </ModalBody>
        </Modal>

        <Modal isOpen={this.state.modalMsg}>
          <ModalHeader>
            <div>
              <h3 style={{ color: "black" }}>{this.state.msjModal}</h3>
            </div>
          </ModalHeader>
          <ModalBody>
            <Button onClick={this.cerrarMsg}>Aceptar</Button>
          </ModalBody>
        </Modal>
        {/* Modal Confirmar Eliminación */}
        <Modal isOpen={this.state.modalConfirm} toggle={this.cancelarEliminacion}>
          <ModalHeader toggle={this.cancelarEliminacion}>
            <span style={{ color: "black", fontWeight: "bold" }}>Confirmar Eliminación</span>
          </ModalHeader>
          <ModalBody style={{ color: "black" }}>
            <p>¿Estás seguro de que deseas eliminar la factura <strong>#{this.state.facturaAEliminar}</strong>?</p>
            <p className="text-muted" style={{ fontSize: "0.875rem" }}>
              Esta acción eliminará de forma permanente sus líneas y detalles de pago asociados.
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "20px" }}>
              <Button color="secondary" onClick={this.cancelarEliminacion}>
                Cancelar
              </Button>
              <Button color="danger" onClick={this.eliminarFactura}>
                <i className="bi bi-trash me-1"></i> Eliminar
              </Button>
            </div>
          </ModalBody>
        </Modal>

        {/* Modal Borrado Masivo por Fechas */}
        <Modal isOpen={this.state.modalBorradoMasivo} size="lg" toggle={this.cerrarModalBorradoMasivo}>
          <ModalHeader toggle={this.cerrarModalBorradoMasivo}>
            <span style={{ color: "black", fontWeight: "bold" }}>Borrar facturas por fechas</span>
          </ModalHeader>
          <ModalBody style={{ color: "black" }}>
            <div className="row g-2 align-items-end">
              <div className="col-md-3">
                <label className="form-label" style={{ fontSize: "0.9rem" }}>Desde</label>
                <input type="date" className="form-control" value={this.state.fechaDesde} onChange={this.handleFechaDesde} />
              </div>
              <div className="col-md-3">
                <label className="form-label" style={{ fontSize: "0.9rem" }}>Hasta</label>
                <input type="date" className="form-control" value={this.state.fechaHasta} onChange={this.handleFechaHasta} />
              </div>
              <div className="col-md-3">
                <label className="form-label" style={{ fontSize: "0.9rem" }}>Aplicar a</label>
                <select className="form-control" value={this.state.bmAplicarA} onChange={this.cambiarBmAplicarA}>
                  <option value="cerradas">Cerradas</option>
                  <option value="abiertas">Abiertas</option>
                  <option value="todas">Todas</option>
                </select>
              </div>
              <div className="col-md-3">
                <Button color="primary" onClick={this.previewBorradoMasivo} disabled={!this.state.fechaDesde || !this.state.fechaHasta || this.state.bmPreviewCargando}>
                  {this.state.bmPreviewCargando ? "Cargando..." : "Ver vista previa"}
                </Button>
              </div>
            </div>
            <p className="text-muted mt-2" style={{ fontSize: "0.85rem" }}>
              {this.state.bmAplicarA === "cerradas" && "Se tomará como criterio la fecha de cierre."}
              {this.state.bmAplicarA === "abiertas" && "Se tomará como criterio la fecha de creación."}
              {this.state.bmAplicarA === "todas" && "Se tomará fecha de cierre para cerradas y fecha de creación para abiertas."}
            </p>

            {this.state.bmPreview && (
              <div style={{ marginTop: "15px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Facturas encontradas: {this.state.bmPreview.count}</strong>
                  <strong>Total: ₡ {Number(this.state.bmPreview.total || 0).toLocaleString("es-CR")}</strong>
                </div>
                {this.state.bmPreview.count > 0 && (
                  <div className="table-responsive" style={{ marginTop: "10px", maxHeight: "250px", overflowY: "auto" }}>
                    <table className="table table-sm table-striped">
                      <thead>
                        <tr>
                          <th>#Factura</th>
                          <th>Mesa</th>
                          <th>Cliente</th>
                          <th>Estado</th>
                          <th>Fecha</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(this.state.bmPreview.facturas || []).map((f) => (
                          <tr key={f.FacturaID}>
                            <td>{f.FacturaID}</td>
                            <td>{f.NombreMesa || "-"}</td>
                            <td>{f.Cliente || "-"}</td>
                            <td>{Number(f.estado) === 1 ? "Abierta" : "Cerrada"}</td>
                            <td>{f.fecha_cierre || f.Fecha || "-"}</td>
                            <td>₡ {f.Total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {this.state.bmPreview.count > 500 && (
                  <p className="text-muted" style={{ fontSize: "0.8rem" }}>Se muestran las primeras 500 en la vista previa.</p>
                )}

                <hr />
                <div style={{ backgroundColor: "#fff3cd", padding: "12px", borderRadius: "6px", border: "1px solid #ffc107" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="checkbox" id="bmCheck" checked={this.state.bmConfirmCheck} onChange={this.toggleBmConfirmCheck} />
                    <label htmlFor="bmCheck" style={{ marginBottom: 0 }}>Entiendo que esta acción es <strong>DEFINITIVA</strong> y no se puede deshacer</label>
                  </div>
                  <div style={{ marginTop: "10px" }}>
                    <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "4px" }}>Escriba <strong>ELIMINAR</strong> para habilitar el botón</label>
                    <input type="text" className="form-control" style={{ maxWidth: "250px" }} value={this.state.bmConfirmTexto} onChange={this.cambiarBmConfirmTexto} placeholder="ELIMINAR" />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "15px" }}>
                  <Button color="secondary" onClick={this.cerrarModalBorradoMasivo} disabled={this.state.bmEliminando}>
                    Cancelar
                  </Button>
                  <Button color="danger" onClick={this.ejecutarBorradoMasivo} disabled={!(this.state.bmConfirmCheck && this.state.bmConfirmTexto.trim().toUpperCase() === "ELIMINAR") || this.state.bmEliminando || this.state.bmPreview.count === 0}>
                    {this.state.bmEliminando ? "Eliminando..." : `Eliminar ${this.state.bmPreview.count} factura(s)`}
                  </Button>
                </div>
              </div>
            )}
          </ModalBody>
        </Modal>
      </div>
    );
  }
}

export default facturas;
