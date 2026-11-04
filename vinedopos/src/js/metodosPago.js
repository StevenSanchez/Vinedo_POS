/**
 * ============================================================================
 * ARCHIVO: src/js/metodosPago.js
 * PROPÓSITO: ABM y orden de los métodos de pago.
 *
 * ENDPOINTS:
 *   GET  /metodos-pago/all      listar activos e inactivos
 *   POST /metodos-pago/add      insertar
 *   POST /metodos-pago/update   renombrar
 *   POST /metodos-pago/delete   desactivar (activo = 0)
 *   POST /metodos-pago/activar  reactivar (activo = 1)
 *   POST /metodos-pago/orden    guardar el orden (ids en orden)
 *
 * El orden guardado se usa al cobrar: los primeros aparecen primero.
 * ============================================================================
 */
import React from "react";
import "../css/crud.css";
import "../css/catalogo.css";
import "../css/metodosPago.css";
import { Navbar, Nav, Container, Modal, Button, Form } from "react-bootstrap";
import axios from "axios";
import Cookies from "universal-cookie";
import Swal from "sweetalert2";
import { ruta } from "../Ruta/ruta";
import logo from "../images/logo.png";

const baseUrl = ruta.baseUrl;
const cookies = new Cookies();

const fueError = (data) =>
  Boolean(
    data &&
      typeof data === "object" &&
      (data.error || data.sqlMessage || data.errno || data.code)
  );

class metodosPago extends React.Component {
  state = {
    metodos: [],
    cargando: true,
    modal: false,
    modo: "crear",
    editId: null,
    nombre: "",
    guardando: false,
    guardandoOrden: false
  };

  componentDidMount() {
    if (!cookies.get("idUsuario")) {
      window.location.href = "/login";
      return;
    }
    this.obtenerMetodos();
  }

  obtenerMetodos = async () => {
    try {
      const res = await axios.get(baseUrl + "metodos-pago/all");
      this.setState({ metodos: res.data || [], cargando: false });
    } catch (e) {
      this.setState({ cargando: false });
      Swal.fire("Error", "No se pudieron cargar los métodos de pago.", "error");
    }
  };

  abrirCrear = () => {
    this.setState({ modal: true, modo: "crear", editId: null, nombre: "" });
  };

  abrirEditar = (metodo) => {
    this.setState({
      modal: true,
      modo: "editar",
      editId: metodo.id,
      nombre: metodo.nombre || ""
    });
  };

  cerrarModal = () => {
    this.setState({ modal: false, guardando: false, editId: null, nombre: "" });
  };

  guardar = async () => {
    const nombre = (this.state.nombre || "").trim().toUpperCase();
    if (!nombre) {
      Swal.fire("Falta el nombre", "Escriba el nombre del método de pago.", "warning");
      return;
    }
    this.setState({ guardando: true });
    try {
      const res =
        this.state.modo === "editar"
          ? await axios.post(baseUrl + "metodos-pago/update", {
              id: this.state.editId,
              nombre
            })
          : await axios.post(baseUrl + "metodos-pago/add", { nombre });
      if (fueError(res.data)) {
        Swal.fire(
          "No se pudo guardar",
          String(res.data.sqlMessage || "").indexOf("Duplicate") >= 0
            ? "Ya existe un método con ese nombre."
            : "Revise el nombre e intente de nuevo.",
          "error"
        );
        this.setState({ guardando: false });
        return;
      }
      await this.obtenerMetodos();
      this.cerrarModal();
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: this.state.modo === "editar" ? "Método actualizado" : "Método agregado",
        showConfirmButton: false,
        timer: 1500
      });
    } catch (e) {
      this.setState({ guardando: false });
      Swal.fire("Error", "No se pudo guardar el método de pago.", "error");
    }
  };

  mover = async (indice, direccion) => {
    const activos = (this.state.metodos || []).filter((m) => Number(m.activo) === 1);
    const destino = indice + direccion;
    if (destino < 0 || destino >= activos.length) return;
    const nuevos = [...activos];
    const temporal = nuevos[indice];
    nuevos[indice] = nuevos[destino];
    nuevos[destino] = temporal;

    this.setState({ guardandoOrden: true });
    try {
      const res = await axios.post(baseUrl + "metodos-pago/orden", {
        ids: nuevos.map((m) => m.id)
      });
      if (fueError(res.data)) throw new Error("respuesta");
      await this.obtenerMetodos();
    } catch (e) {
      Swal.fire("Error", "No se pudo guardar el orden.", "error");
      await this.obtenerMetodos();
    } finally {
      this.setState({ guardandoOrden: false });
    }
  };

  desactivar = async (metodo) => {
    const confirmacion = await Swal.fire({
      title: "Desactivar método",
      html: "¿Ocultar <strong>" + (metodo.nombre || "") + "</strong> al cobrar?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Desactivar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280"
    });
    if (!confirmacion.isConfirmed) return;
    try {
      await axios.post(baseUrl + "metodos-pago/delete", { id: metodo.id });
      await this.obtenerMetodos();
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Método desactivado",
        showConfirmButton: false,
        timer: 1500
      });
    } catch (e) {
      Swal.fire("Error", "No se pudo desactivar el método.", "error");
    }
  };

  activar = async (metodo) => {
    try {
      await axios.post(baseUrl + "metodos-pago/activar", { id: metodo.id });
      await this.obtenerMetodos();
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Método activado",
        showConfirmButton: false,
        timer: 1500
      });
    } catch (e) {
      Swal.fire("Error", "No se pudo activar el método.", "error");
    }
  };

  cerrarSesion = () => {
    cookies.remove("idUsuario", { path: "/" });
    cookies.remove("usuario", { path: "/" });
    window.location.href = "/login";
  };

  renderFila = (metodo, indice, activo) => (
    <div className="metodo-fila" key={metodo.id}>
      <div className="metodo-orden">
        {activo ? (
          <>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              title="Subir"
              aria-label="Subir"
              disabled={indice === 0 || this.state.guardandoOrden}
              onClick={() => this.mover(indice, -1)}
            >
              <i className="bi bi-chevron-up"></i>
            </button>
            <span>{indice + 1}</span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              title="Bajar"
              aria-label="Bajar"
              disabled={
                indice ===
                  (this.state.metodos || []).filter((m) => Number(m.activo) === 1).length - 1 ||
                this.state.guardandoOrden
              }
              onClick={() => this.mover(indice, 1)}
            >
              <i className="bi bi-chevron-down"></i>
            </button>
          </>
        ) : (
          <i className="bi bi-dash-circle" style={{ color: "#cbd5e1" }}></i>
        )}
      </div>
      <div className="metodo-nombre">{metodo.nombre}</div>
      <span className={"metodo-estado " + (activo ? "activo" : "inactivo")}>
        {activo ? "Activo" : "Inactivo"}
      </span>
      <div className="metodo-acciones">
        <Button size="sm" variant="outline-secondary" onClick={() => this.abrirEditar(metodo)}>
          <i className="bi bi-pencil"></i> Editar
        </Button>
        {activo ? (
          <Button size="sm" variant="outline-danger" onClick={() => this.desactivar(metodo)}>
            <i className="bi bi-eye-slash"></i> Desactivar
          </Button>
        ) : (
          <Button size="sm" variant="outline-success" onClick={() => this.activar(metodo)}>
            <i className="bi bi-arrow-clockwise"></i> Activar
          </Button>
        )}
      </div>
    </div>
  );

  render() {
    const { metodos, cargando, modal, modo, nombre, guardando, guardandoOrden } = this.state;
    const activos = (metodos || []).filter((m) => Number(m.activo) === 1);
    const inactivos = (metodos || []).filter((m) => Number(m.activo) !== 1);

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
              <Navbar.Toggle aria-controls="metodos-nav" />
              <Navbar.Collapse id="metodos-nav">
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
                <h2>Métodos de pago</h2>
                <p className="config-sub">
                  Ordena los métodos para que los más usados aparezcan primero al cobrar.
                </p>
              </div>
              <div className="config-header-actions">
                <button type="button" className="btn btn-success btn-lg px-4" onClick={this.abrirCrear}>
                  <i className="bi bi-plus-lg"></i> Nuevo método
                </button>
              </div>
            </div>

            <div className="metodos-ayuda">
              <i className="bi bi-arrow-down-up"></i>
              <div>
                Usa las flechas para cambiar el orden. El primero de la lista será el primero
                que verás al cobrar en Pedidos.
                {guardandoOrden ? " Guardando orden..." : ""}
              </div>
            </div>

            {cargando ? (
              <p>Cargando métodos...</p>
            ) : (
              <>
                <h4 className="metodos-subtitulo">
                  Activos <span className="config-badge">{activos.length}</span>
                </h4>
                {activos.length === 0 ? (
                  <div className="metodos-vacio">
                    No hay métodos activos. Agrega uno con “Nuevo método”.
                  </div>
                ) : (
                  <div className="metodos-lista">
                    {activos.map((metodo, indice) => this.renderFila(metodo, indice, true))}
                  </div>
                )}

                {inactivos.length > 0 && (
                  <>
                    <h4 className="metodos-subtitulo">
                      Inactivos <span className="config-badge">{inactivos.length}</span>
                    </h4>
                    <div className="metodos-lista">
                      {inactivos.map((metodo, indice) => this.renderFila(metodo, indice, false))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <Modal show={modal} onHide={this.cerrarModal} centered className="catalog-form">
          <Modal.Header closeButton>
            <Modal.Title>
              {modo === "editar" ? "Editar método de pago" : "Nuevo método de pago"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                this.guardar();
              }}
            >
              <Form.Group>
                <Form.Label>Nombre</Form.Label>
                <Form.Control
                  autoFocus
                  type="text"
                  value={nombre}
                  maxLength={50}
                  placeholder="Ej. TARJETA BAC, SINPE MÓVIL..."
                  onChange={(e) => this.setState({ nombre: e.target.value })}
                />
              </Form.Group>
            </Form>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={this.cerrarModal}>
              Cancelar
            </Button>
            <Button variant="success" onClick={this.guardar} disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar"}
            </Button>
          </Modal.Footer>
        </Modal>
      </div>
    );
  }
}

export default metodosPago;
