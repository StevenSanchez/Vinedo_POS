/**
 * ============================================================================
 * ARCHIVO: src/js/cierre.js
 * PANTALLA: /cierre  (Fase 3)
 * PROPÓSITO: cierre de caja con resumen de facturas pendientes, desglose por
 * método de pago, arqueo de efectivo, histórico persistente e impresión.
 *
 * ENDPOINTS:
 *   GET  /cierre/pendientes/  -> { Facturas, Metodos, Resumen }
 *   POST /cierre/             -> { ok, Cierre } (recibe FacturaIDs confirmados)
 *   GET  /cierre/historial/   -> lista de cierres
 *   GET  /cierre/:id          -> detalle de un cierre
 *
 * COMPORTAMIENTO:
 *  - La vista previa NO modifica nada; solo el POST crea el cierre.
 *  - Se envían los IDs exactos que el usuario confirmó en pantalla.
 *  - El cierre guarda cabecera, desglose por método y snapshot de facturas.
 *  - El efectivo contado es opcional; si se escribe, se calcula la diferencia
 *    contra el efectivo neto esperado (recibido - vuelto).
 *  - Al terminar se ofrece imprimir el reporte térmico (ticket.js).
 * ============================================================================
 */
import React from "react";
import "../css/cierre.css";
import { Navbar, Nav, Container } from "react-bootstrap";
import { Button, Modal, ModalBody, ModalHeader } from "reactstrap";
import Cookies from "universal-cookie";
import axios from "axios";
import Swal from "sweetalert2";
import { ruta } from "../Ruta/ruta";
import { formatearMoneda, obtenerConfigTicket, imprimirTicket } from "./ticket";
import { construirCierreHTML } from "./cierreReporte";
import logo from "../images/logo.png";

const baseUrl = ruta.baseUrl;
const cookies = new Cookies();

const redondear = (valor) => Math.round((Number(valor) || 0) * 100) / 100;

const resumenVacio = {
  CantidadFacturas: 0,
  Total: 0,
  EfectivoRecibido: 0,
  Vuelto: 0,
  EfectivoNeto: 0,
  Desde: null,
  Hasta: null
};

class cierre extends React.Component {
  state = {
    cargando: true,
    procesando: false,
    error: "",
    facturas: [],
    metodos: [],
    resumen: { ...resumenVacio },
    historial: [],
    efectivoContado: "",
    observaciones: "",
    modalDetalle: false,
    cargandoDetalle: false,
    cierreDetalle: null
  };

  componentDidMount() {
    if (!cookies.get("idUsuario")) {
      window.location.href = "/login";
      return;
    }
    this.cargarTodo();
  }

  dinero = (valor) => formatearMoneda(valor, "cr");

  formatearFecha = (valor) => {
    if (!valor) return "-";
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

  mesaCliente = (factura) => {
    const mesa = factura.NombreMesa || (factura.MesaID ? "Mesa " + factura.MesaID : "-");
    const cliente = String(factura.Cliente || "").trim();
    return cliente ? `${mesa} · ${cliente}` : mesa;
  };

  cargarTodo = async () => {
    this.setState({ cargando: true, error: "" });
    try {
      const [pendientes, historial] = await Promise.all([
        axios.get(baseUrl + "cierre/pendientes/"),
        axios.get(baseUrl + "cierre/historial/")
      ]);
      const datos = pendientes.data || {};
      this.setState({
        facturas: Array.isArray(datos.Facturas) ? datos.Facturas : [],
        metodos: Array.isArray(datos.Metodos) ? datos.Metodos : [],
        resumen: { ...resumenVacio, ...(datos.Resumen || {}) },
        historial: Array.isArray(historial.data) ? historial.data : [],
        cargando: false
      });
    } catch (e) {
      this.setState({
        cargando: false,
        error:
          (e.response && e.response.data && e.response.data.error) ||
          "No se pudo consultar el cierre de caja. Revise la conexión con el API."
      });
    }
  };

  recargar = () => {
    this.cargarTodo();
  };

  cambiarContado = (e) => {
    this.setState({ efectivoContado: e.target.value });
  };

  cambiarObservaciones = (e) => {
    this.setState({ observaciones: e.target.value });
  };

  diferencia = () => {
    const texto = String(this.state.efectivoContado || "").trim();
    if (texto === "") return null;
    const contado = Number(texto);
    if (!Number.isFinite(contado)) return null;
    return redondear(contado - Number(this.state.resumen.EfectivoNeto || 0));
  };

  cerrarCaja = async () => {
    const { facturas, resumen, procesando } = this.state;
    if (procesando) return;
    if (!facturas.length) {
      Swal.fire("Sin facturas", "No hay facturas cerradas pendientes de cierre.", "info");
      return;
    }
    const ids = facturas.map((f) => Number(f.FacturaID)).filter((id) => id > 0);
    if (!ids.length) {
      Swal.fire("Sin facturas", "No hay facturas válidas para cerrar.", "info");
      return;
    }

    const confirmacion = await Swal.fire({
      title: "¿Confirmar cierre de caja?",
      html:
        `Se cerrarán <strong>${ids.length}</strong> factura(s) por un total de ` +
        `<strong>${this.dinero(resumen.Total)}</strong>.<br><br>` +
        "Las facturas quedarán marcadas como cerradas de caja y no volverán a aparecer en el próximo cierre.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Sí, cerrar caja",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#7c3aed"
    });
    if (!confirmacion.isConfirmed) return;

    this.setState({ procesando: true, error: "" });
    try {
      const contado = String(this.state.efectivoContado || "").trim();
      const res = await axios.post(baseUrl + "cierre/", {
        FacturaIDs: ids,
        efectivo_contado: contado === "" ? null : Number(contado),
        observaciones: String(this.state.observaciones || "").trim(),
        usuario_id: Number(cookies.get("idUsuario")) || null
      });
      const creado = (res.data && res.data.Cierre) || null;
      this.setState({
        procesando: false,
        efectivoContado: "",
        observaciones: ""
      });
      await this.cargarTodo();

      if (!creado) {
        Swal.fire("Cierre guardado", "El cierre de caja se guardó correctamente.", "success");
        return;
      }

      const accion = await Swal.fire({
        title: `Cierre #${creado.CierreID} guardado`,
        html:
          `Facturas: <strong>${creado.CantidadFacturas}</strong><br>` +
          `Total: <strong>${this.dinero(creado.Total)}</strong><br>` +
          `Efectivo neto: <strong>${this.dinero(creado.EfectivoNeto)}</strong>`,
        icon: "success",
        showCancelButton: true,
        confirmButtonText: "Imprimir reporte",
        cancelButtonText: "Listo",
        confirmButtonColor: "#7c3aed"
      });
      if (accion.isConfirmed) {
        await this.imprimirCierre(creado);
      }
    } catch (e) {
      this.setState({ procesando: false });
      const mensaje =
        (e.response && e.response.data && e.response.data.error) ||
        "No se pudo guardar el cierre de caja.";
      Swal.fire("No se guardó el cierre", mensaje, "error");
      if (e.response && e.response.status === 400) {
        this.cargarTodo();
      }
    }
  };

  imprimirCierre = async (detalle) => {
    if (!detalle) return;
    try {
      const config = await obtenerConfigTicket();
      const html = construirCierreHTML(detalle, config);
      await imprimirTicket(html);
    } catch (e) {
      Swal.fire("Impresión", "No se pudo generar el reporte de cierre.", "error");
    }
  };

  verDetalle = async (CierreID) => {
    this.setState({ modalDetalle: true, cargandoDetalle: true, cierreDetalle: null });
    try {
      const res = await axios.get(baseUrl + "cierre/" + CierreID);
      this.setState({ cierreDetalle: res.data || null, cargandoDetalle: false });
    } catch (e) {
      this.setState({ modalDetalle: false, cargandoDetalle: false });
      Swal.fire("Detalle", "No se pudo consultar el cierre seleccionado.", "error");
    }
  };

  cerrarDetalle = () => {
    this.setState({ modalDetalle: false, cierreDetalle: null });
  };

  reimprimir = async (CierreID) => {
    try {
      const res = await axios.get(baseUrl + "cierre/" + CierreID);
      await this.imprimirCierre(res.data);
    } catch (e) {
      Swal.fire("Impresión", "No se pudo obtener el cierre para imprimir.", "error");
    }
  };

  cerrarSesion = () => {
    cookies.remove("idUsuario", { path: "/" });
    cookies.remove("usuario", { path: "/" });
    window.location.href = "/login";
  };

  renderPendientes() {
    const { facturas, cargando } = this.state;
    if (cargando) {
      return <p className="cierre-vacio">Cargando facturas pendientes…</p>;
    }
    if (!facturas.length) {
      return (
        <p className="cierre-vacio">
          No hay facturas cerradas pendientes de cierre. Cuando cobre una mesa,
          aparecerá aquí.
        </p>
      );
    }
    return (
      <div className="cierre-tabla-scroll">
        <table className="cierre-tabla">
          <thead>
            <tr>
              <th>#Factura</th>
              <th>Mesa / Cliente</th>
              <th>Cobrada</th>
              <th className="der">Total</th>
              <th className="der">Vuelto</th>
            </tr>
          </thead>
          <tbody>
            {facturas.map((f) => (
              <tr key={f.FacturaID}>
                <td className="num">#{f.FacturaID}</td>
                <td>{this.mesaCliente(f)}</td>
                <td className="fecha">{this.formatearFecha(f.fecha_cierre)}</td>
                <td className="der num">{this.dinero(f.Total)}</td>
                <td className="der num">{this.dinero(f.Vuelto)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="3">Total pendiente</td>
              <td className="der num">{this.dinero(this.state.resumen.Total)}</td>
              <td className="der num">{this.dinero(this.state.resumen.Vuelto)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  renderMetodos() {
    const { metodos } = this.state;
    if (!metodos.length) {
      return <p className="cierre-vacio">Sin métodos de pago configurados.</p>;
    }
    return (
      <table className="cierre-tabla metodos">
        <thead>
          <tr>
            <th>Método</th>
            <th className="der">Pagos</th>
            <th className="der">Monto</th>
          </tr>
        </thead>
        <tbody>
          {metodos.map((m) => (
            <tr key={m.metodo_pago}>
              <td>{m.metodo_pago}</td>
              <td className="der num">{Number(m.cantidad || 0)}</td>
              <td className="der num">{this.dinero(m.monto)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  renderHistorial() {
    const { historial, cargando } = this.state;
    if (cargando) {
      return <p className="cierre-vacio">Cargando histórico…</p>;
    }
    if (!historial.length) {
      return <p className="cierre-vacio">Todavía no hay cierres de caja guardados.</p>;
    }
    return (
      <div className="cierre-tabla-scroll">
        <table className="cierre-tabla">
          <thead>
            <tr>
              <th>#Cierre</th>
              <th>Fecha</th>
              <th>Usuario</th>
              <th className="der">Facturas</th>
              <th className="der">Total</th>
              <th className="der">Efectivo neto</th>
              <th className="der">Diferencia</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {historial.map((c) => (
              <tr key={c.CierreID}>
                <td className="num">#{c.CierreID}</td>
                <td className="fecha">{this.formatearFecha(c.fecha)}</td>
                <td>{c.usuario || "-"}</td>
                <td className="der num">{c.CantidadFacturas}</td>
                <td className="der num">{this.dinero(c.Total)}</td>
                <td className="der num">{this.dinero(c.EfectivoNeto)}</td>
                <td
                  className={
                    "der num " +
                    (c.Diferencia === null || Number(c.Diferencia) === 0
                      ? ""
                      : Number(c.Diferencia) > 0
                      ? "positivo"
                      : "negativo")
                  }
                >
                  {c.Diferencia === null || c.Diferencia === undefined
                    ? "-"
                    : this.dinero(c.Diferencia)}
                </td>
                <td className="acciones">
                  <button className="cierre-btn-mini" onClick={() => this.verDetalle(c.CierreID)}>
                    Ver
                  </button>
                  <button className="cierre-btn-mini" onClick={() => this.reimprimir(c.CierreID)}>
                    Imprimir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  renderDetalleModal() {
    const { modalDetalle, cargandoDetalle, cierreDetalle } = this.state;
    return (
      <Modal isOpen={modalDetalle} toggle={this.cerrarDetalle} size="lg">
        <ModalHeader toggle={this.cerrarDetalle}>
          {cierreDetalle ? `Cierre #${cierreDetalle.CierreID}` : "Detalle del cierre"}
        </ModalHeader>
        <ModalBody>
          {cargandoDetalle && <p>Cargando detalle…</p>}
          {!cargandoDetalle && !cierreDetalle && <p>No se pudo cargar el detalle.</p>}
          {!cargandoDetalle && cierreDetalle && (
            <div className="cierre-detalle">
              <div className="cierre-detalle-datos">
                <div><span>Fecha</span><strong>{this.formatearFecha(cierreDetalle.fecha)}</strong></div>
                <div><span>Usuario</span><strong>{cierreDetalle.usuario || "-"}</strong></div>
                <div><span>Facturas</span><strong>{cierreDetalle.CantidadFacturas}</strong></div>
                <div><span>Total</span><strong>{this.dinero(cierreDetalle.Total)}</strong></div>
                <div><span>Efectivo recibido</span><strong>{this.dinero(cierreDetalle.EfectivoRecibido)}</strong></div>
                <div><span>Vuelto</span><strong>{this.dinero(cierreDetalle.Vuelto)}</strong></div>
                <div><span>Efectivo neto</span><strong>{this.dinero(cierreDetalle.EfectivoNeto)}</strong></div>
                <div>
                  <span>Efectivo contado</span>
                  <strong>
                    {cierreDetalle.EfectivoContado === null
                      ? "No registrado"
                      : this.dinero(cierreDetalle.EfectivoContado)}
                  </strong>
                </div>
                <div>
                  <span>Diferencia</span>
                  <strong
                    className={
                      cierreDetalle.Diferencia === null
                        ? ""
                        : Number(cierreDetalle.Diferencia) > 0
                        ? "positivo"
                        : Number(cierreDetalle.Diferencia) < 0
                        ? "negativo"
                        : ""
                    }
                  >
                    {cierreDetalle.Diferencia === null
                      ? "No registrada"
                      : this.dinero(cierreDetalle.Diferencia)}
                  </strong>
                </div>
              </div>

              <h6>Métodos de pago</h6>
              <table className="cierre-tabla metodos">
                <thead>
                  <tr>
                    <th>Método</th>
                    <th className="der">Pagos</th>
                    <th className="der">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {cierreDetalle.Metodos.map((m) => (
                    <tr key={m.metodo_pago}>
                      <td>{m.metodo_pago}</td>
                      <td className="der num">{m.cantidad}</td>
                      <td className="der num">{this.dinero(m.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h6>Facturas incluidas</h6>
              <div className="cierre-tabla-scroll">
                <table className="cierre-tabla">
                  <thead>
                    <tr>
                      <th>#Factura</th>
                      <th>Mesa / Cliente</th>
                      <th className="der">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cierreDetalle.Facturas.map((f) => (
                      <tr key={f.FacturaID}>
                        <td className="num">#{f.FacturaID}</td>
                        <td>{this.mesaCliente(f)}</td>
                        <td className="der num">{this.dinero(f.Total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {String(cierreDetalle.Observaciones || "").trim() !== "" && (
                <>
                  <h6>Observaciones</h6>
                  <p className="cierre-observaciones">{cierreDetalle.Observaciones}</p>
                </>
              )}

              <div className="cierre-detalle-acciones">
                <Button color="secondary" onClick={this.cerrarDetalle}>Cerrar</Button>
                <Button color="primary" onClick={() => this.imprimirCierre(cierreDetalle)}>
                  Imprimir reporte
                </Button>
              </div>
            </div>
          )}
        </ModalBody>
      </Modal>
    );
  }

  render() {
    const {
      cargando,
      procesando,
      error,
      resumen,
      efectivoContado
    } = this.state;
    const diferencia = this.diferencia();
    const sinFacturas = !this.state.facturas.length;

    return (
      <div className="App-body">
        <Navbar collapseOnSelect expand="lg" bg="dark" variant="dark">
          <Container>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <button
                id="btNavbar"
                onClick={() => { window.location.href = "/administracion"; }}
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
            <Navbar.Toggle aria-controls="responsive-navbar-nav" />
            <Navbar.Collapse id="responsive-navbar-nav">
              <Nav className="me-auto">
                <Nav.Link href="/administracion">
                  <button id="btNavbar">Administración</button>
                </Nav.Link>
                <Nav.Link href="/mesas">
                  <button id="btNavbar">Mesas</button>
                </Nav.Link>
                <Nav.Link href="/facturas">
                  <button id="btNavbar">Facturas</button>
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

        <div className="cierre-container">
          <div className="cierre-panel">
            <div className="cierre-cabecera">
              <div>
                <h2>Cierre de caja</h2>
                <p>Revise las facturas cobradas, el desglose por método y el efectivo antes de cerrar.</p>
              </div>
              <button className="cierre-btn-secundario" onClick={this.recargar} disabled={cargando || procesando}>
                {cargando ? "Actualizando…" : "Actualizar"}
              </button>
            </div>

            {error && <div className="cierre-alerta">{error}</div>}

            <div className="cierre-stats">
              <div className="cierre-stat">
                <span>Facturas pendientes</span>
                <strong>{resumen.CantidadFacturas}</strong>
              </div>
              <div className="cierre-stat">
                <span>Total cobrado</span>
                <strong>{this.dinero(resumen.Total)}</strong>
              </div>
              <div className="cierre-stat">
                <span>Efectivo neto esperado</span>
                <strong>{this.dinero(resumen.EfectivoNeto)}</strong>
              </div>
              <div className="cierre-stat">
                <span>Vuelto entregado</span>
                <strong>{this.dinero(resumen.Vuelto)}</strong>
              </div>
            </div>

            <div className="cierre-periodo">
              Periodo de cobros: <strong>{this.formatearFecha(resumen.Desde)}</strong> a{" "}
              <strong>{this.formatearFecha(resumen.Hasta)}</strong>
            </div>

            <div className="cierre-columnas">
              <section className="cierre-bloque">
                <h3>Facturas por cerrar</h3>
                {this.renderPendientes()}
              </section>

              <section className="cierre-bloque">
                <h3>Métodos de pago</h3>
                {this.renderMetodos()}

                <h3 className="separado">Arqueo de efectivo</h3>
                <div className="cierre-arqueo">
                  <div className="cierre-linea">
                    <span>Efectivo recibido</span>
                    <strong>{this.dinero(resumen.EfectivoRecibido)}</strong>
                  </div>
                  <div className="cierre-linea">
                    <span>Vuelto entregado</span>
                    <strong>{this.dinero(resumen.Vuelto)}</strong>
                  </div>
                  <div className="cierre-linea total">
                    <span>Efectivo neto esperado</span>
                    <strong>{this.dinero(resumen.EfectivoNeto)}</strong>
                  </div>
                  <label className="cierre-campo" htmlFor="efectivoContado">
                    <span>Efectivo contado (opcional)</span>
                    <input
                      id="efectivoContado"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={efectivoContado}
                      onChange={this.cambiarContado}
                      disabled={procesando || sinFacturas}
                    />
                  </label>
                  <div
                    className={
                      "cierre-linea diferencia " +
                      (diferencia === null
                        ? ""
                        : diferencia > 0
                        ? "positivo"
                        : diferencia < 0
                        ? "negativo"
                        : "cuadra")
                    }
                  >
                    <span>Diferencia</span>
                    <strong>{diferencia === null ? "—" : this.dinero(diferencia)}</strong>
                  </div>
                </div>

                <label className="cierre-campo" htmlFor="observaciones">
                  <span>Observaciones (opcional)</span>
                  <textarea
                    id="observaciones"
                    rows="2"
                    maxLength="255"
                    value={this.state.observaciones}
                    onChange={this.cambiarObservaciones}
                    disabled={procesando || sinFacturas}
                    placeholder="Ej.: faltante de ₡500, pago pendiente de verificar…"
                  />
                </label>

                <p className="cierre-nota">
                  Se cerrarán exactamente las <strong>{resumen.CantidadFacturas}</strong> factura(s)
                  listadas. Las facturas cobradas después de esta vista quedarán para el próximo cierre.
                </p>

                <button
                  className="cierre-btn-principal"
                  onClick={this.cerrarCaja}
                  disabled={procesando || sinFacturas}
                >
                  {procesando ? "Guardando cierre…" : "Confirmar cierre de caja"}
                </button>
              </section>
            </div>

            <section className="cierre-bloque historial">
              <h3>Histórico de cierres</h3>
              {this.renderHistorial()}
            </section>
          </div>
        </div>

        {this.renderDetalleModal()}
      </div>
    );
  }
}

export default cierre;
