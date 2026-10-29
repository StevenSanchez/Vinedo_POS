/**
 * ============================================================================
 * ARCHIVO: src/js/metodosPago.js
 * PROPÓSITO: ABM de métodos de pago (EFECTIVO, SINPE, tarjetas, etc.).
 *
 * ENDPOINTS:
 *   GET  /metodos-pago/all      listar activos e inactivos
 *   POST /metodos-pago/add      insertar (nombre en MAYÚSCULAS desde el cliente)
 *   POST /metodos-pago/update   renombrar
 *   POST /metodos-pago/delete   DESACTIVA (activo = 0), no borra
 *   POST /metodos-pago/activar  reactiva (activo = 1)
 *
 * NOTA: el cobro de Pedidos solo ofrece los métodos con activo = 1.
 * El nombre del método se guarda como texto en pagos_factura (snapshot).
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

class metodosPago extends React.Component {
  state = {
    metodos: [],
    modalInsert: false,
    msjModal: "",
    nombre: "",
    editId: null,
    editNombre: ""
  };

  componentDidMount() {
    if (!cookies.get("idUsuario")) {
      window.location.href = "/login";
    } else {
      this.obtenerMetodos();
    }
  }

  obtenerMetodos = async () => {
    const res = await axios.get(baseUrl + "metodos-pago/all");
    this.setState({ metodos: res.data || [] });
  };

  agregar = async () => {
    if (this.state.nombre.trim() === "") return;
    await axios.post(baseUrl + "metodos-pago/add", { nombre: this.state.nombre.toUpperCase() });
    this.setState({ modalInsert: true, msjModal: "Método de pago agregado", nombre: "" });
    document.getElementById("mpNombre").value = "";
    this.obtenerMetodos();
  };

  editar = (m) => {
    this.setState({ editId: m.id, editNombre: m.nombre });
  };

  guardarEditar = async () => {
    if (!this.state.editId || this.state.editNombre.trim() === "") return;
    await axios.post(baseUrl + "metodos-pago/update", { id: this.state.editId, nombre: this.state.editNombre.toUpperCase() });
    this.setState({ modalInsert: true, msjModal: "Método de pago actualizado", editId: null, editNombre: "" });
    this.obtenerMetodos();
  };

  cancelarEditar = () => {
    this.setState({ editId: null, editNombre: "" });
  };

  eliminar = async (m) => {
    await axios.post(baseUrl + "metodos-pago/delete", { id: m.id });
    this.setState({ modalInsert: true, msjModal: "Método de pago desactivado" });
    this.obtenerMetodos();
  };

  activar = async (m) => {
    await axios.post(baseUrl + "metodos-pago/activar", { id: m.id });
    this.setState({ modalInsert: true, msjModal: "Método de pago activado" });
    this.obtenerMetodos();
  };

  handlechange = (e) => {
    this.setState({ [e.target.name]: e.target.value });
  };

  handleEditChange = (e) => {
    this.setState({ editNombre: e.target.value });
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
          <div className="TablaDatos" style={{ maxWidth: "700px" }}>
            <h2>Métodos de pago</h2>
            <div style={{ display: "flex", gap: "10px", justifyContent: "center", marginTop: "20px", flexWrap: "wrap" }}>
              <input id="mpNombre" type="text" className="categoria" placeholder="Nombre (ej. TARJETA BANCO)" name="nombre" onChange={this.handlechange} />
              <input type="submit" id="confirmar" value="Agregar" onClick={() => this.agregar()} />
            </div>
            <hr style={{ marginTop: 30 }} />
            <table className="table table-hover table-sm" style={{ marginTop: "20px" }}>
              <thead className="thead-dark">
                <tr>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th>Editar</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {this.state.metodos.map((m, index) => (
                  <tr key={index}>
                    <td style={{ textAlign: "left" }}>
                      {this.state.editId === m.id ? (
                        <input type="text" value={this.state.editNombre} onChange={this.handleEditChange} />
                      ) : (
                        m.nombre
                      )}
                    </td>
                    <td>{m.activo === 1 ? "Activo" : "Inactivo"}</td>
                    <td>
                      {this.state.editId === m.id ? (
                        <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
                          <button className="btn btn-success btn-sm" onClick={this.guardarEditar}><i className="bi bi-check"></i></button>
                          <button className="btn btn-secondary btn-sm" onClick={this.cancelarEditar}><i className="bi bi-x"></i></button>
                        </div>
                      ) : (
                        <button className="btn btn-primary btn-sm" onClick={() => this.editar(m)}><i className="bi bi-pencil-square"></i></button>
                      )}
                    </td>
                    <td>
                      {m.activo === 1 ? (
                        <button className="btn btn-danger btn-sm" onClick={() => this.eliminar(m)}><i className="bi bi-trash"></i></button>
                      ) : (
                        <button className="btn btn-success btn-sm" onClick={() => this.activar(m)}><i className="bi bi-arrow-clockwise"></i></button>
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

export default metodosPago;
