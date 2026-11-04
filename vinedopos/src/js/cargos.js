/**
 * ============================================================================
 * ARCHIVO: src/js/cargos.js
 * PROPÓSITO: ABM de cargos por porcentaje (servicio/propina).
 *
 * ENDPOINTS:
 *   GET  /cargos/all      listar todos
 *   POST /cargos/add      insertar { nombre, porcentaje, predeterminado }
 *   POST /cargos/update   editar { idCargo, nombre, porcentaje, predeterminado }
 *   POST /cargos/delete   desactivar
 *   POST /cargos/activar  reactivar
 * ============================================================================
 */
import React from "react";
import "../css/crud.css";
import "../css/catalogo.css";
import "../css/cargos.css";
import { Navbar, Nav, Container, Modal, Button, Form } from "react-bootstrap";
import axios from "axios";
import Cookies from "universal-cookie";
import Swal from "sweetalert2";
import { ruta } from "../Ruta/ruta";
import logo from "../images/logo.png";

const baseUrl = ruta.baseUrl;
const cookies = new Cookies();

const formVacio = () => ({ nombre: "", porcentaje: "", predeterminado: false });

const fueError = (data) =>
  Boolean(
    data &&
      typeof data === "object" &&
      (data.error || data.sqlMessage || data.errno || data.code)
  );

class cargos extends React.Component {
  state = {
    cargos: [],
    cargando: true,
    modal: false,
    modo: "crear",
    editId: null,
    form: formVacio(),
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
    this.setState({ cargando: true });
    try {
      const res = await axios.get(baseUrl + "cargos/all");
      this.setState({ cargos: res.data || [], cargando: false });
    } catch (e) {
      this.setState({ cargando: false });
      Swal.fire("Error", "No se pudieron cargar los cargos.", "error");
    }
  };

  abrirCrear = () => {
    this.setState({ modal: true, modo: "crear", editId: null, form: formVacio() });
  };

  abrirEditar = (cargo) => {
    this.setState({
      modal: true,
      modo: "editar",
      editId: cargo.idCargo,
      form: {
        nombre: cargo.nombre || "",
        porcentaje: cargo.porcentaje != null ? String(cargo.porcentaje) : "",
        predeterminado: Number(cargo.predeterminado) === 1
      }
    });
  };

  cerrarModal = () => {
    this.setState({ modal: false, guardando: false, editId: null, form: formVacio() });
  };

  cambiarCampo = (campo, valor) => {
    this.setState({ form: { ...this.state.form, [campo]: valor } });
  };

  guardar = async () => {
    const nombre = (this.state.form.nombre || "").trim().toUpperCase();
    const porcentaje = Number(this.state.form.porcentaje);
    if (!nombre) {
      Swal.fire("Falta el nombre", "Escriba el nombre del cargo.", "warning");
      return;
    }
    if (Number.isNaN(porcentaje) || porcentaje <= 0 || porcentaje > 100) {
      Swal.fire("Porcentaje inválido", "Debe estar entre 0.01 y 100.", "warning");
      return;
    }
    this.setState({ guardando: true });
    try {
      const datos = {
        nombre,
        porcentaje,
        predeterminado: this.state.form.predeterminado ? 1 : 0
      };
      const res =
        this.state.modo === "editar"
          ? await axios.post(baseUrl + "cargos/update", {
              ...datos,
              idCargo: this.state.editId
            })
          : await axios.post(baseUrl + "cargos/add", datos);
      if (fueError(res.data)) throw new Error("respuesta");
      await this.cargar();
      this.cerrarModal();
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: this.state.modo === "editar" ? "Cargo actualizado" : "Cargo agregado",
        showConfirmButton: false,
        timer: 1500
      });
    } catch (e) {
      this.setState({ guardando: false });
      const mensaje =
        (e && e.response && e.response.data && e.response.data.error) ||
        "No se pudo guardar el cargo.";
      Swal.fire("Error", mensaje, "error");
    }
  };

  desactivar = async (cargo) => {
    const confirmacion = await Swal.fire({
      title: "Desactivar cargo",
      html:
        "¿Ocultar <strong>" +
        (cargo.nombre || "") +
        "</strong> en las cuentas nuevas?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Desactivar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280"
    });
    if (!confirmacion.isConfirmed) return;
    try {
      await axios.post(baseUrl + "cargos/delete", { idCargo: cargo.idCargo });
      await this.cargar();
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Cargo desactivado",
        showConfirmButton: false,
        timer: 1500
      });
    } catch (e) {
      Swal.fire("Error", "No se pudo desactivar el cargo.", "error");
    }
  };

  activar = async (cargo) => {
    try {
      await axios.post(baseUrl + "cargos/activar", { idCargo: cargo.idCargo });
      await this.cargar();
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Cargo activado",
        showConfirmButton: false,
        timer: 1500
      });
    } catch (e) {
      Swal.fire("Error", "No se pudo activar el cargo.", "error");
    }
  };

  cerrarSesion = () => {
    cookies.remove("idUsuario", { path: "/" });
    cookies.remove("usuario", { path: "/" });
    window.location.href = "/login";
  };

  renderCargo = (cargo, activo) => (
    <div className="catalog-card cargo-card" key={cargo.idCargo}>
      <div className="catalog-card-head">
        <h3>{cargo.nombre}</h3>
        <span className={"metodo-estado " + (activo ? "activo" : "inactivo")}>
          {activo ? "Activo" : "Inactivo"}
        </span>
      </div>
      <div className="cargo-porcentaje">{Number(cargo.porcentaje || 0)}%</div>
      <div className="cargo-etiquetas">
        {Number(cargo.predeterminado) === 1 ? (
          <span className="catalog-badge cargo-default">
            <i className="bi bi-check2-circle"></i> Por defecto
          </span>
        ) : (
          <span className="cargo-sin-default">No se aplica por defecto</span>
        )}
      </div>
      <div className="catalog-actions">
        <Button size="sm" variant="outline-secondary" onClick={() => this.abrirEditar(cargo)}>
          <i className="bi bi-pencil"></i> Editar
        </Button>
        {activo ? (
          <Button size="sm" variant="outline-danger" onClick={() => this.desactivar(cargo)}>
            <i className="bi bi-eye-slash"></i> Desactivar
          </Button>
        ) : (
          <Button size="sm" variant="outline-success" onClick={() => this.activar(cargo)}>
            <i className="bi bi-arrow-clockwise"></i> Activar
          </Button>
        )}
      </div>
    </div>
  );

  render() {
    const { cargos, cargando, modal, modo, form, guardando } = this.state;
    const activos = (cargos || []).filter((c) => Number(c.activo) === 1);
    const inactivos = (cargos || []).filter((c) => Number(c.activo) !== 1);

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
              <Navbar.Toggle aria-controls="cargos-nav" />
              <Navbar.Collapse id="cargos-nav">
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
                <h2>Cargos / Servicio</h2>
                <p className="config-sub">
                  Servicio, propina u otros cargos por porcentaje. Se aplican a la cuenta desde
                  Pedidos y salen en el ticket.
                </p>
              </div>
              <div className="config-header-actions">
                <button type="button" className="btn btn-success btn-lg px-4" onClick={this.abrirCrear}>
                  <i className="bi bi-plus-lg"></i> Nuevo cargo
                </button>
              </div>
            </div>

            <div className="metodos-ayuda">
              <i className="bi bi-percent"></i>
              <div>
                El monto se calcula como <strong>base × porcentaje ÷ 100</strong>. “Aplicar por
                defecto” solo afecta las cuentas nuevas; las cuentas abiertas conservan su cargo.
              </div>
            </div>

            {cargando ? (
              <p>Cargando cargos...</p>
            ) : (
              <>
                <h4 className="metodos-subtitulo">
                  Activos <span className="config-badge">{activos.length}</span>
                </h4>
                {activos.length === 0 ? (
                  <div className="catalog-empty">
                    <i className="bi bi-percent"></i>
                    No hay cargos activos. Agrega uno con “Nuevo cargo”.
                  </div>
                ) : (
                  <div className="catalog-grid">
                    {activos.map((cargo) => this.renderCargo(cargo, true))}
                  </div>
                )}

                {inactivos.length > 0 && (
                  <>
                    <h4 className="metodos-subtitulo">
                      Inactivos <span className="config-badge">{inactivos.length}</span>
                    </h4>
                    <div className="catalog-grid">
                      {inactivos.map((cargo) => this.renderCargo(cargo, false))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <Modal show={modal} onHide={this.cerrarModal} centered className="catalog-form">
          <Modal.Header closeButton>
            <Modal.Title>{modo === "editar" ? "Editar cargo" : "Nuevo cargo"}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                this.guardar();
              }}
            >
              <Form.Group className="mb-3">
                <Form.Label>Nombre</Form.Label>
                <Form.Control
                  autoFocus
                  type="text"
                  maxLength={60}
                  value={form.nombre}
                  placeholder="Ej. SERVICIO, PROPINA..."
                  onChange={(e) => this.cambiarCampo("nombre", e.target.value)}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Porcentaje</Form.Label>
                <div className="input-group">
                  <Form.Control
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={form.porcentaje}
                    placeholder="10"
                    onChange={(e) => this.cambiarCampo("porcentaje", e.target.value)}
                  />
                  <span className="input-group-text">%</span>
                </div>
              </Form.Group>
              <Form.Check
                type="checkbox"
                id="cargo-predeterminado"
                label="Aplicar por defecto en cuentas nuevas"
                checked={Boolean(form.predeterminado)}
                onChange={(e) => this.cambiarCampo("predeterminado", e.target.checked)}
              />
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

export default cargos;
