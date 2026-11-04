/**
 * ============================================================================
 * ARCHIVO: src/js/facturas.js
 * PROPÓSITO: histórico de facturas (abiertas y cerradas): listar, ver detalle,
 * reimprimir y borrar.
 *
 * ENDPOINTS:
 *   GET  /facturas/lista?estado=todas|abiertas|cerradas
 *   GET  /facturas/detalle/:id   -> { cabecera, lineas, pagos, cargos }
 *   POST /facturas/eliminar
 *   POST /facturas/eliminar/por-fechas/preview
 *   POST /facturas/eliminar/por-fechas
 * ============================================================================
 */
import React from "react";
import "../css/crud.css";
import "../css/facturas.css";
import { Navbar, Nav, Container, Modal, Button } from "react-bootstrap";
import axios from "axios";
import Cookies from "universal-cookie";
import Swal from "sweetalert2";
import { ruta } from "../Ruta/ruta";
import {
  construirTicketHTML,
  datosDesdeDetalle,
  imprimirTicket,
  obtenerConfigTicket
} from "./ticket";
import logo from "../images/logo.png";

const baseUrl = ruta.baseUrl;
const cookies = new Cookies();

class facturas extends React.Component {
  state = {
    facturas: [],
    cargando: true,
    filtro: "todas",
    busqueda: "",
    fechaDesde: "",
    fechaHasta: "",
    modalDetalle: false,
    detalleCargando: false,
    detalle: { cabecera: null, lineas: [], pagos: [], cargos: [] },
    modalBorradoMasivo: false,
    bmAplicarA: "cerradas",
    bmPreview: null,
    bmPreviewCargando: false,
    bmConfirmCheck: false,
    bmConfirmTexto: "",
    bmEliminando: false
  };

  componentDidMount() {
    if (!cookies.get("idUsuario")) {
      window.location.href = "/login";
      return;
    }
    this.obtenerFacturas();
  }

  handleBusqueda = (e) => this.setState({ busqueda: e.target.value });
  handleFechaDesde = (e) => this.setState({ fechaDesde: e.target.value });
  handleFechaHasta = (e) => this.setState({ fechaHasta: e.target.value });
  limpiarFiltrosFechas = () => this.setState({ fechaDesde: "", fechaHasta: "" });

  formatearFecha = (fecha) => {
    if (!fecha) return "-";
    try {
      // El API ya entrega las fechas como dd/mm/yyyy hh:mm AM/PM.
      if (typeof fecha === "string" && /^\d{2}\/\d{2}\/\d{4}/.test(fecha)) {
        return fecha;
      }
      if (typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        const [y, m, d] = fecha.split("-");
        return d + "/" + m + "/" + y;
      }
      const d = new Date(fecha);
      if (isNaN(d.getTime())) return String(fecha);
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      return dd + "/" + mm + "/" + yyyy + " " + hh + ":" + mi;
    } catch (e) {
      return String(fecha);
    }
  };

  parsearFechaLocal = (fecha) => {
    if (!fecha) return null;
    try {
      if (typeof fecha === "string" && fecha.includes("T")) {
        const d = new Date(fecha);
        if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      }
      if (typeof fecha === "string") {
        const m1 = fecha.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m1) return new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]));
        const m2 = fecha.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (m2) return new Date(Number(m2[3]), Number(m2[2]) - 1, Number(m2[1]));
      }
      const d = new Date(fecha);
      if (isNaN(d.getTime())) return null;
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    } catch (e) {
      return null;
    }
  };

  obtenerFechaFiltro = (f) => {
    if (this.state.filtro === "cerradas") return this.parsearFechaLocal(f.fecha_cierre);
    if (this.state.filtro === "abiertas") {
      return this.parsearFechaLocal(f.Fecha || f.fecha_creacion || f.Hora);
    }
    return this.parsearFechaLocal(
      f.fecha_cierre || f.Fecha || f.fecha_creacion || f.Hora
    );
  };

  obtenerFacturas = async () => {
    this.setState({ cargando: true });
    try {
      const res = await axios.get(baseUrl + "facturas/lista?estado=" + this.state.filtro);
      this.setState({ facturas: Array.isArray(res.data) ? res.data : [], cargando: false });
    } catch (e) {
      this.setState({ facturas: [], cargando: false });
      Swal.fire("Error", "No se pudieron cargar las facturas.", "error");
    }
  };

  cambiarFiltro = (filtro) => {
    this.setState({ filtro }, this.obtenerFacturas);
  };

  verDetalle = async (factura) => {
    this.setState({ modalDetalle: true, detalleCargando: true });
    try {
      const res = await axios.get(baseUrl + "facturas/detalle/" + factura.FacturaID);
      this.setState({
        detalle: res.data || { cabecera: null, lineas: [], pagos: [], cargos: [] },
        detalleCargando: false
      });
    } catch (e) {
      this.setState({ detalleCargando: false, modalDetalle: false });
      Swal.fire("Error", "No se pudo cargar el detalle de la factura.", "error");
    }
  };

  cerrarDetalle = () => this.setState({ modalDetalle: false });

  reimprimir = async (factura) => {
    try {
      const [res, config] = await Promise.all([
        axios.get(baseUrl + "facturas/detalle/" + factura.FacturaID),
        obtenerConfigTicket()
      ]);
      const detalle = res.data || { cabecera: null, lineas: [], pagos: [] };
      const abierta = detalle.cabecera && Number(detalle.cabecera.estado) === 1;
      const modo = abierta ? "prefactura" : "factura";
      const html = construirTicketHTML(datosDesdeDetalle(detalle, modo), config, modo);
      await imprimirTicket(html);
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Ticket enviado a impresión",
        showConfirmButton: false,
        timer: 1600
      });
    } catch (e) {
      Swal.fire("Error", "No se pudo reimprimir el ticket.", "error");
    }
  };

  confirmarEliminacion = async (facturaID) => {
    const confirmacion = await Swal.fire({
      title: "Eliminar factura",
      html:
        "¿Eliminar definitivamente la factura <strong>#" +
        facturaID +
        "</strong>?<br/><span style='font-size:.85rem'>Se borrarán sus líneas y pagos asociados.</span>",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280"
    });
    if (!confirmacion.isConfirmed) return;
    try {
      await axios.post(baseUrl + "facturas/eliminar", { FacturaID: facturaID });
      await this.obtenerFacturas();
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Factura eliminada",
        showConfirmButton: false,
        timer: 1600
      });
    } catch (e) {
      Swal.fire("Error", "No se pudo eliminar la factura.", "error");
    }
  };

  // ---- Borrado masivo por fechas ----
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
    this.setState({
      bmAplicarA: e.target.value,
      bmPreview: null,
      bmConfirmCheck: false,
      bmConfirmTexto: ""
    });
  };

  previewBorradoMasivo = async () => {
    if (!this.state.fechaDesde || !this.state.fechaHasta) {
      Swal.fire("Faltan fechas", "Seleccione fecha Desde y Hasta.", "warning");
      return;
    }
    this.setState({
      bmPreviewCargando: true,
      bmPreview: null,
      bmConfirmCheck: false,
      bmConfirmTexto: ""
    });
    try {
      const res = await axios.post(baseUrl + "facturas/eliminar/por-fechas/preview", {
        fechaDesde: this.state.fechaDesde,
        fechaHasta: this.state.fechaHasta,
        aplicarA: this.state.bmAplicarA
      });
      this.setState({ bmPreview: res.data, bmPreviewCargando: false });
    } catch (e) {
      this.setState({ bmPreviewCargando: false });
      Swal.fire(
        "Error",
        (e.response && e.response.data && e.response.data.error) ||
          "No se pudo obtener la vista previa.",
        "error"
      );
    }
  };

  toggleBmConfirmCheck = (e) => this.setState({ bmConfirmCheck: e.target.checked });
  cambiarBmConfirmTexto = (e) => this.setState({ bmConfirmTexto: e.target.value });

  ejecutarBorradoMasivo = async () => {
    if (!this.state.fechaDesde || !this.state.fechaHasta) {
      Swal.fire("Faltan fechas", "Seleccione fecha Desde y Hasta.", "warning");
      return;
    }
    if (
      !this.state.bmConfirmCheck ||
      this.state.bmConfirmTexto.trim().toUpperCase() !== "ELIMINAR"
    ) {
      Swal.fire(
        "Confirmación incompleta",
        "Marque la casilla y escriba ELIMINAR para continuar.",
        "warning"
      );
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
        bmConfirmTexto: ""
      });
      await this.obtenerFacturas();
      Swal.fire({
        icon: "success",
        title: "Borrado completado",
        text: "Se eliminaron " + (res.data && res.data.eliminadas ? res.data.eliminadas : 0) + " facturas.",
        confirmButtonText: "Aceptar"
      });
    } catch (e) {
      this.setState({ bmEliminando: false });
      Swal.fire(
        "Error",
        (e.response && e.response.data && e.response.data.error) ||
          "No se pudo completar el borrado por fechas.",
        "error"
      );
    }
  };

  cerrarSesion = () => {
    cookies.remove("idUsuario", { path: "/" });
    cookies.remove("usuario", { path: "/" });
    window.location.href = "/login";
  };

  renderDetalle = () => {
    const { cabecera, lineas, pagos, cargos } = this.state.detalle;
    if (!cabecera) return null;
    const base = (lineas || []).reduce((acc, l) => acc + Number(l.Subtotal || 0), 0);
    const cargosTotal = (cargos || []).reduce((acc, c) => acc + Number(c.monto || 0), 0);
    return (
      <>
        <div className="factura-detalle-info">
          <div>
            <span>Mesa</span>
            <strong>{cabecera.MesaNombre || "-"}</strong>
          </div>
          <div>
            <span>Cliente</span>
            <strong>{cabecera.Cliente || "General"}</strong>
          </div>
          <div>
            <span>Creada</span>
            <strong>
              {cabecera.Hora && cabecera.Fecha
                ? cabecera.Fecha + " " + cabecera.Hora
                : this.formatearFecha(cabecera.Fecha || cabecera.Hora)}
            </strong>
          </div>
          <div>
            <span>Cerrada</span>
            <strong>{this.formatearFecha(cabecera.fecha_cierre)}</strong>
          </div>
          <div>
            <span>Cobrado por</span>
            <strong>{cabecera.UsuarioCobro || "-"}</strong>
          </div>
          <div>
            <span>Vuelto</span>
            <strong>₡ {Number(cabecera.vuelto || 0).toLocaleString("es-CR")}</strong>
          </div>
        </div>

        <h6>Productos</h6>
        <div className="table-responsive">
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
              {(lineas || []).map((linea, i) => (
                <tr key={i}>
                  <td>{linea.Nombre}</td>
                  <td>{linea.Cantidad}</td>
                  <td>₡ {Number(linea.Precio || 0).toLocaleString("es-CR")}</td>
                  <td>₡ {Number(linea.Subtotal || 0).toLocaleString("es-CR")}</td>
                </tr>
              ))}
              {(lineas || []).length === 0 && (
                <tr>
                  <td colSpan="4" className="text-muted">
                    Sin productos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {(cargos || []).length > 0 && (
          <>
            <h6>Cargos / Servicio</h6>
            <div className="table-responsive">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Cargo</th>
                    <th>Porcentaje</th>
                    <th>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {(cargos || []).map((cargo, i) => (
                    <tr key={i}>
                      <td>{cargo.nombre}</td>
                      <td>{cargo.porcentaje}%</td>
                      <td>₡ {Number(cargo.monto || 0).toLocaleString("es-CR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <h6>Pagos</h6>
        <div className="table-responsive">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Método</th>
                <th>Monto</th>
                <th>Referencia</th>
              </tr>
            </thead>
            <tbody>
              {(pagos || []).map((pago, i) => (
                <tr key={i}>
                  <td>{pago.metodo_pago}</td>
                  <td>₡ {Number(pago.monto || 0).toLocaleString("es-CR")}</td>
                  <td>{pago.referencia || "-"}</td>
                </tr>
              ))}
              {(pagos || []).length === 0 && (
                <tr>
                  <td colSpan="3" className="text-muted">
                    Sin pagos registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="factura-detalle-total">
          <div>
            <span>Base: ₡ {base.toLocaleString("es-CR")}</span>
            {cargosTotal > 0 && (
              <span> · Cargos: ₡ {cargosTotal.toLocaleString("es-CR")}</span>
            )}
          </div>
          <strong>Total: ₡ {Number(cabecera.Total || 0).toLocaleString("es-CR")}</strong>
        </div>
      </>
    );
  };

  render() {
    const {
      facturas,
      cargando,
      filtro,
      busqueda,
      fechaDesde,
      fechaHasta,
      modalDetalle,
      detalleCargando,
      detalle,
      modalBorradoMasivo,
      bmAplicarA,
      bmPreview,
      bmPreviewCargando,
      bmConfirmCheck,
      bmConfirmTexto,
      bmEliminando
    } = this.state;

    const busq = busqueda.trim().toLowerCase();
    const facturasFiltradas = (Array.isArray(facturas) ? facturas : []).filter((f) => {
      if (busq) {
        const idStr = String(f.FacturaID || "").toLowerCase();
        const cliente = String(f.Cliente || "").toLowerCase();
        const mesa = String(f.MesaNombre || f.NombreMesa || f.MesaID || "").toLowerCase();
        if (!idStr.includes(busq) && !cliente.includes(busq) && !mesa.includes(busq)) return false;
      }
      const fechaFiltro = this.obtenerFechaFiltro(f);
      if (fechaFiltro) {
        if (fechaDesde) {
          const desde = new Date(fechaDesde + "T00:00:00");
          if (fechaFiltro < new Date(desde.getFullYear(), desde.getMonth(), desde.getDate())) return false;
        }
        if (fechaHasta) {
          const hasta = new Date(fechaHasta + "T00:00:00");
          if (fechaFiltro > new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate())) return false;
        }
      }
      return true;
    });

    const sumaTotal = facturasFiltradas.reduce((acc, f) => acc + Number(f.Total || 0), 0);
    const abiertas = facturasFiltradas.filter((f) => Number(f.estado) === 1).length;
    const cerradas = facturasFiltradas.length - abiertas;
    const promedio = facturasFiltradas.length > 0 ? sumaTotal / facturasFiltradas.length : 0;
    const bmListo =
      bmPreview &&
      bmPreview.count > 0 &&
      bmConfirmCheck &&
      bmConfirmTexto.trim().toUpperCase() === "ELIMINAR";

    return (
      <div className="App-body">
        <div>
          <Navbar collapseOnSelect expand="lg" bg="dark" variant="dark">
            <Container>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  className="btnNavbar"
                  onClick={() => {
                    window.location.href = "/administracion";
                  }}
                  style={{ padding: "0.3rem 0.7rem" }}
                >
                  <i className="bi bi-arrow-left"></i> Volver
                </button>
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
              <Navbar.Toggle aria-controls="facturas-nav" />
              <Navbar.Collapse id="facturas-nav">
                <Nav className="me-auto">
                  <Nav.Link href="/administracion">
                    <button className="btnNavbar">Administración</button>
                  </Nav.Link>
                  <Nav.Link href="/mesas">
                    <button className="btnNavbar">Mesas</button>
                  </Nav.Link>
                </Nav>
                <Nav>
                  <Nav.Link>
                    <button className="btnNavbar" onClick={this.cerrarSesion}>
                      Cerrar sesión
                    </button>
                  </Nav.Link>
                </Nav>
              </Navbar.Collapse>
            </Container>
          </Navbar>
        </div>

        <div className="config-shell">
          <div className="config-panel">
            <div className="config-header">
              <div>
                <h2>Facturas</h2>
                <p className="config-sub">
                  Consulta el histórico, revisa el detalle, reimprime tickets y elimina facturas.
                </p>
              </div>
              <div className="config-header-actions">
                <button
                  type="button"
                  className="btn btn-outline-danger btn-lg px-4"
                  onClick={this.abrirModalBorradoMasivo}
                >
                  <i className="bi bi-trash3"></i> Borrar por fechas
                </button>
              </div>
            </div>

            <div className="facturas-kpis">
              <div className="factura-kpi">
                <span>Facturas</span>
                <strong>{facturasFiltradas.length}</strong>
                <small>Según los filtros actuales</small>
              </div>
              <div className="factura-kpi">
                <span>Total facturado</span>
                <strong>₡ {sumaTotal.toLocaleString("es-CR")}</strong>
                <small>Suma de los resultados</small>
              </div>
              <div className="factura-kpi">
                <span>Ticket promedio</span>
                <strong>₡ {promedio.toLocaleString("es-CR", { maximumFractionDigits: 2 })}</strong>
                <small>Promedio de resultados</small>
              </div>
              <div className="factura-kpi">
                <span>Abiertas</span>
                <strong>{abiertas}</strong>
                <small>{cerradas} cerradas</small>
              </div>
            </div>

            <div className="facturas-toolbar">
              <div className="facturas-tabs">
                <button
                  type="button"
                  className={filtro === "todas" ? "activa" : ""}
                  onClick={() => this.cambiarFiltro("todas")}
                >
                  Todas
                </button>
                <button
                  type="button"
                  className={filtro === "abiertas" ? "activa" : ""}
                  onClick={() => this.cambiarFiltro("abiertas")}
                >
                  Abiertas
                </button>
                <button
                  type="button"
                  className={filtro === "cerradas" ? "activa" : ""}
                  onClick={() => this.cambiarFiltro("cerradas")}
                >
                  Cerradas
                </button>
              </div>

              <div className="facturas-busqueda">
                <i className="bi bi-search"></i>
                <input
                  type="text"
                  placeholder="Factura, cliente o mesa..."
                  value={busqueda}
                  onChange={this.handleBusqueda}
                />
              </div>

              <div className="facturas-fechas">
                <span>Desde</span>
                <input type="date" value={fechaDesde} onChange={this.handleFechaDesde} />
                <span>Hasta</span>
                <input type="date" value={fechaHasta} onChange={this.handleFechaHasta} />
                {(fechaDesde || fechaHasta) && (
                  <Button size="sm" variant="outline-secondary" onClick={this.limpiarFiltrosFechas}>
                    Limpiar
                  </Button>
                )}
              </div>

              <span className="catalog-count">
                {facturasFiltradas.length} resultado{facturasFiltradas.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="table-responsive">
              <table className="table table-sm tabla-factura facturas-tabla">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Mesa / Cliente</th>
                    <th>Creada</th>
                    <th>Cerrada</th>
                    <th>Total</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {cargando && (
                    <tr>
                      <td colSpan="7" className="text-center text-muted py-4">
                        Cargando facturas...
                      </td>
                    </tr>
                  )}
                  {!cargando &&
                    facturasFiltradas.map((f) => {
                      const abierta = Number(f.estado) === 1;
                      return (
                        <tr key={f.FacturaID}>
                          <td><strong>#{f.FacturaID}</strong></td>
                          <td>
                            <strong>{f.MesaNombre || "-"}</strong>
                            <div className="factura-cliente">{f.Cliente || "General"}</div>
                          </td>
                          <td>
                            {f.Hora && f.Fecha
                              ? f.Fecha + " " + f.Hora
                              : this.formatearFecha(f.Fecha || f.Hora || f.fecha_creacion)}
                          </td>
                          <td>{this.formatearFecha(f.fecha_cierre)}</td>
                          <td>₡ {Number(f.Total || 0).toLocaleString("es-CR")}</td>
                          <td>
                            <span className={"factura-estado " + (abierta ? "abierta" : "cerrada")}>
                              {abierta ? "Abierta" : "Cerrada"}
                            </span>
                          </td>
                          <td>
                            <div className="factura-acciones">
                              <Button
                                size="sm"
                                variant="outline-secondary"
                                title="Ver detalle"
                                aria-label="Ver detalle"
                                onClick={() => this.verDetalle(f)}
                              >
                                <i className="bi bi-eye"></i>
                              </Button>
                              <Button
                                size="sm"
                                variant="outline-secondary"
                                title={abierta ? "Imprimir prefactura" : "Reimprimir ticket"}
                                aria-label="Reimprimir"
                                onClick={() => this.reimprimir(f)}
                              >
                                <i className="bi bi-printer"></i>
                              </Button>
                              <Button
                                size="sm"
                                variant="outline-danger"
                                title="Eliminar factura"
                                aria-label="Eliminar factura"
                                onClick={() => this.confirmarEliminacion(f.FacturaID)}
                              >
                                <i className="bi bi-trash"></i>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  {!cargando && facturasFiltradas.length === 0 && (
                    <tr>
                      <td colSpan="7">
                        <div className="factura-empty">
                          <i className="bi bi-receipt"></i>
                          No hay facturas que coincidan con los filtros.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <Modal show={modalDetalle} onHide={this.cerrarDetalle} size="lg" centered className="factura-detalle-modal">
          <Modal.Header closeButton>
            <Modal.Title>
              Factura #{detalle.cabecera ? detalle.cabecera.FacturaID : ""}
              {detalle.cabecera && (
                <span
                  className={
                    "factura-estado ms-2 " +
                    (Number(detalle.cabecera.estado) === 1 ? "abierta" : "cerrada")
                  }
                >
                  {Number(detalle.cabecera.estado) === 1 ? "Abierta" : "Cerrada"}
                </span>
              )}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body style={{ maxHeight: "70vh", overflowY: "auto" }}>
            {detalleCargando ? <p>Cargando detalle...</p> : this.renderDetalle()}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={this.cerrarDetalle}>
              Cerrar
            </Button>
            {detalle.cabecera && (
              <Button
                variant="outline-primary"
                onClick={() => this.reimprimir(detalle.cabecera)}
              >
                <i className="bi bi-printer"></i> Reimprimir
              </Button>
            )}
          </Modal.Footer>
        </Modal>

        <Modal
          show={modalBorradoMasivo}
          onHide={this.cerrarModalBorradoMasivo}
          size="lg"
          centered
          className="factura-bulk-modal"
        >
          <Modal.Header closeButton>
            <Modal.Title>
              <i className="bi bi-trash3"></i> Borrar facturas por fechas
            </Modal.Title>
          </Modal.Header>
          <Modal.Body style={{ maxHeight: "72vh", overflowY: "auto" }}>
            <div className="row g-2 align-items-end">
              <div className="col-md-4">
                <label className="form-label">Desde</label>
                <input
                  type="date"
                  className="form-control"
                  value={fechaDesde}
                  onChange={this.handleFechaDesde}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Hasta</label>
                <input
                  type="date"
                  className="form-control"
                  value={fechaHasta}
                  onChange={this.handleFechaHasta}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Aplicar a</label>
                <select
                  className="form-select"
                  value={bmAplicarA}
                  onChange={this.cambiarBmAplicarA}
                >
                  <option value="cerradas">Cerradas</option>
                  <option value="abiertas">Abiertas</option>
                  <option value="todas">Todas</option>
                </select>
              </div>
            </div>
            <div className="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
              <span className="text-muted small">
                {bmAplicarA === "cerradas" && "Se usa la fecha de cierre."}
                {bmAplicarA === "abiertas" && "Se usa la fecha de creación."}
                {bmAplicarA === "todas" && "Cierre para cerradas y creación para abiertas."}
              </span>
              <Button
                variant="outline-primary"
                onClick={this.previewBorradoMasivo}
                disabled={!fechaDesde || !fechaHasta || bmPreviewCargando}
              >
                {bmPreviewCargando ? "Consultando..." : "Ver vista previa"}
              </Button>
            </div>

            {bmPreview && (
              <div className="mt-3">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <strong>{bmPreview.count} facturas encontradas</strong>
                  <strong>
                    ₡ {Number(bmPreview.total || 0).toLocaleString("es-CR")}
                  </strong>
                </div>
                {bmPreview.count > 0 && (
                  <div className="table-responsive" style={{ maxHeight: "240px", overflowY: "auto" }}>
                    <table className="table table-sm table-striped">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Mesa</th>
                          <th>Cliente</th>
                          <th>Estado</th>
                          <th>Fecha</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(bmPreview.facturas || []).map((f) => (
                          <tr key={f.FacturaID}>
                            <td>#{f.FacturaID}</td>
                            <td>{f.NombreMesa || "-"}</td>
                            <td>{f.Cliente || "-"}</td>
                            <td>{Number(f.estado) === 1 ? "Abierta" : "Cerrada"}</td>
                            <td>{f.fecha_cierre || f.Fecha || "-"}</td>
                            <td>₡ {Number(f.Total || 0).toLocaleString("es-CR")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {bmPreview.count > 500 && (
                  <p className="text-muted small">Se muestran las primeras 500 en la vista previa.</p>
                )}

                <div className="factura-bulk-warning">
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="bmCheck"
                      checked={bmConfirmCheck}
                      onChange={this.toggleBmConfirmCheck}
                    />
                    <label className="form-check-label" htmlFor="bmCheck">
                      Entiendo que esta acción es <strong>DEFINITIVA</strong> y no se puede deshacer.
                    </label>
                  </div>
                  <div className="mt-2">
                    <label className="form-label small mb-1">
                      Escriba <strong>ELIMINAR</strong> para habilitar el botón
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      style={{ maxWidth: "240px" }}
                      value={bmConfirmTexto}
                      onChange={this.cambiarBmConfirmTexto}
                      placeholder="ELIMINAR"
                    />
                  </div>
                </div>
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={this.cerrarModalBorradoMasivo}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={this.ejecutarBorradoMasivo}
              disabled={!bmListo || bmEliminando}
            >
              {bmEliminando
                ? "Eliminando..."
                : "Eliminar " + (bmPreview && bmPreview.count ? bmPreview.count : 0) + " facturas"}
            </Button>
          </Modal.Footer>
        </Modal>
      </div>
    );
  }
}

export default facturas;
