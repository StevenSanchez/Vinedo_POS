/**
 * ============================================================================
 * ARCHIVO: src/js/cargos.js
 * PROPÓSITO: ABM de cargos por porcentaje (servicio/propina).
 *
 * ENDPOINTS:
 *   GET  /cargos/all      listar todos
 *   POST /cargos/add      insertar { nombre, porcentaje, predeterminado }
 *   POST /cargos/update   editar { idCargo, nombre, porcentaje, predeterminado }
 *   POST /cargos/delete   DESACTIVA el cargo
 *   POST /cargos/activar  reactiva
 *
 * REGLAS:
 *  - Nombre en MAYÚSCULAS (el backend también lo normaliza).
 *  - Porcentaje entre 0.01 y 100.
 *  - "Aplicar por defecto" (cargo.predeterminado = 1) solo afecta a las
 *    CUENTAS NUEVAS; no modifica las cuentas ya abiertas.
 *  - El monto NO se guarda: se calcula como base * porcentaje / 100.
 *  - Al editar el porcentaje, las cuentas abiertas conservan el porcentaje
 *    guardado en factura_cargo.
 * ============================================================================
 */
import React from "react";
import "../css/crud.css";
import { Navbar, Nav, Container } from "react-bootstrap";
import axios from "axios";
import Cookies from "universal-cookie";
import { Button, Modal, ModalBody, ModalHeader } from "reactstrap";
import { ruta } from "../Ruta/ruta";
import logo from "../images/logo.png"
const baseUrl = ruta.baseUrl;
const cookies = new Cookies();

class cargos extends React.Component {
  state = {
    cargos: [],
    modalInsert: false,
    msjModal: "",
    nombre: "",
    porcentaje: "",
    predeterminado: false,
    editId: null,
    editNombre: "",
    editPorcentaje: "",
    editPredeterminado: false
  };

  componentDidMount() {
    if (!cookies.get("idUsuario")) {
      window.location.href = "/login";
    } else {
      this.obtenerCargos();
    }
  }

  obtenerCargos = async () => {
    const res = await axios.get(baseUrl + "cargos/all");
    this.setState({ cargos: res.data || [] });
  };

  validar = (nombre, porcentaje) => {
    if ((nombre || "").trim() === "") return "Escriba el nombre del cargo";
    const pct = Number(porcentaje);
    if (isNaN(pct) || pct <= 0 || pct > 100) return "El porcentaje debe estar entre 0.01 y 100";
    return null;
  };

  agregar = async () => {
    const error = this.validar(this.state.nombre, this.state.porcentaje);
    if (error) {
      this.setState({ modalInsert: true, msjModal: error });
      return;
    }
    try {
      await axios.post(baseUrl + "cargos/add", {
        nombre: this.state.nombre.toUpperCase(),
        porcentaje: Number(this.state.porcentaje),
        predeterminado: this.state.predeterminado ? 1 : 0
      });
      this.setState({ modalInsert: true, msjModal: "Cargo agregado", nombre: "", porcentaje: "", predeterminado: false });
      this.obtenerCargos();
    } catch (e) {
      const msj = e.response && e.response.data && e.response.data.error
        ? e.response.data.error
        : "No se pudo agregar el cargo";
      this.setState({ modalInsert: true, msjModal: msj });
    }
  };

  editar = (c) => {
    this.setState({
      editId: c.idCargo,
      editNombre: c.nombre,
      editPorcentaje: c.porcentaje,
      editPredeterminado: Number(c.predeterminado) === 1
    });
  };

  guardarEditar = async () => {
    const error = this.validar(this.state.editNombre, this.state.editPorcentaje);
    if (error) {
      this.setState({ modalInsert: true, msjModal: error });
      return;
    }
    try {
      await axios.post(baseUrl + "cargos/update", {
        idCargo: this.state.editId,
        nombre: this.state.editNombre.toUpperCase(),
        porcentaje: Number(this.state.editPorcentaje),
        predeterminado: this.state.editPredeterminado ? 1 : 0
      });
      this.setState({
        modalInsert: true,
        msjModal: "Cargo actualizado",
        editId: null,
        editNombre: "",
        editPorcentaje: "",
        editPredeterminado: false
      });
      this.obtenerCargos();
    } catch (e) {
      const msj = e.response && e.response.data && e.response.data.error
        ? e.response.data.error
        : "No se pudo actualizar el cargo";
      this.setState({ modalInsert: true, msjModal: msj });
    }
  };

  cancelarEditar = () => {
    this.setState({ editId: null, editNombre: "", editPorcentaje: "", editPredeterminado: false });
  };

  eliminar = async (c) => {
    await axios.post(baseUrl + "cargos/delete", { idCargo: c.idCargo });
    this.setState({ modalInsert: true, msjModal: "Cargo desactivado" });
    this.obtenerCargos();
  };

  activar = async (c) => {
    await axios.post(baseUrl + "cargos/activar", { idCargo: c.idCargo });
    this.setState({ modalInsert: true, msjModal: "Cargo activado" });
    this.obtenerCargos();
  };

  handlechange = (e) => {
    this.setState({ [e.target.name]: e.target.value });
  };

  ocultarModal = () => {
    this.setState({ modalInsert: false });
  };

  cerrarSesion = () => {
    cookies.remove("idUsuario", { path: "/" });
    cookies.remove("usuario", { path: "/" });
    window.location.href = "/login";
  };

  render() {
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
          <div className="TablaDatos" style={{ maxWidth: "760px" }}>
            <h2>Cargos por porcentaje</h2>
            <p style={{ color: "#6b7280", marginTop: "6px" }}>
              Servicio, propina u otros. Se aplican a la cuenta desde Pedidos y salen en el ticket.
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "center", marginTop: "20px", flexWrap: "wrap" }}>
              <input id="cargoNombre" type="text" className="categoria" placeholder="Nombre (ej. SERVICIO)" name="nombre" value={this.state.nombre} onChange={this.handlechange} />
              <input id="cargoPorcentaje" type="number" className="categoria" placeholder="Porcentaje %" name="porcentaje" min="0.01" max="100" step="0.01" value={this.state.porcentaje} onChange={this.handlechange} />
              <label style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0, cursor: "pointer" }}>
                <input type="checkbox" checked={this.state.predeterminado} onChange={(e) => this.setState({ predeterminado: e.target.checked })} />
                Aplicar por defecto
              </label>
              <input type="submit" id="confirmar" value="Agregar" onClick={() => this.agregar()} />
            </div>
            <hr style={{ marginTop: 30 }} />
            <table className="table table-hover table-sm" style={{ marginTop: "20px" }}>
              <thead className="thead-dark">
                <tr>
                  <th>Nombre</th>
                  <th>Porcentaje</th>
                  <th>Por defecto</th>
                  <th>Estado</th>
                  <th>Editar</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {this.state.cargos.map((c, index) => (
                  <tr key={index}>
                    <td style={{ textAlign: "left" }}>
                      {this.state.editId === c.idCargo ? (
                        <input type="text" value={this.state.editNombre} onChange={(e) => this.setState({ editNombre: e.target.value })} />
                      ) : (
                        c.nombre
                      )}
                    </td>
                    <td>
                      {this.state.editId === c.idCargo ? (
                        <input type="number" style={{ width: "90px" }} min="0.01" max="100" step="0.01" value={this.state.editPorcentaje} onChange={(e) => this.setState({ editPorcentaje: e.target.value })} />
                      ) : (
                        c.porcentaje + "%"
                      )}
                    </td>
                    <td>
                      {this.state.editId === c.idCargo ? (
                        <input type="checkbox" checked={this.state.editPredeterminado} onChange={(e) => this.setState({ editPredeterminado: e.target.checked })} />
                      ) : (
                        Number(c.predeterminado) === 1 ? "Sí" : "—"
                      )}
                    </td>
                    <td>{c.activo === 1 ? "Activo" : "Inactivo"}</td>
                    <td>
                      {this.state.editId === c.idCargo ? (
                        <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
                          <button className="btn btn-success btn-sm" onClick={this.guardarEditar}><i className="bi bi-check"></i></button>
                          <button className="btn btn-secondary btn-sm" onClick={this.cancelarEditar}><i className="bi bi-x"></i></button>
                        </div>
                      ) : (
                        <button className="btn btn-primary btn-sm" onClick={() => this.editar(c)}><i className="bi bi-pencil-square"></i></button>
                      )}
                    </td>
                    <td>
                      {c.activo === 1 ? (
                        <button className="btn btn-danger btn-sm" onClick={() => this.eliminar(c)}><i className="bi bi-trash"></i></button>
                      ) : (
                        <button className="btn btn-success btn-sm" onClick={() => this.activar(c)}><i className="bi bi-arrow-clockwise"></i></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <Modal isOpen={this.state.modalInsert}>
          <ModalHeader>
            <div>
              <h3 style={{ color: "black" }}>{this.state.msjModal}</h3>
            </div>
          </ModalHeader>
          <ModalBody>
            <Button onClick={() => this.ocultarModal()}>Aceptar</Button>
          </ModalBody>
        </Modal>
      </div>
    );
  }
}

export default cargos;
