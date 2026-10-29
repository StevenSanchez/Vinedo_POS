/**
 * ============================================================================
 * ARCHIVO: src/js/crudCategoria.js
 * PROPÓSITO: ABM de categorías del menú.
 *
 * ENDPOINTS:
 *   GET  /categorias/        listar
 *   POST /Categoria/add      insertar
 *   POST /Categoria/update   renombrar (categoriaAntigua = id)
 *   POST /Categoria/delete   borrar
 *
 * ESTILO: legado imperativo. Usa document.getElementById(...).value y
 * style.display para mostrar/ocultar los paneles Agregar / Modificar /
 * Eliminar, en lugar de estado de React.
 *
 * TRAMPA CONOCIDA: insertarCategoria y actualizarCategoria llaman a
 * "http://localhost:9000/..." escrito a mano. Si el POS se abre desde otra PC
 * de la red, esas dos acciones apuntan al localhost del cliente y fallan.
 * El resto del archivo sí usa `baseUrl` (src/Ruta/ruta.js).
 * ============================================================================
 */
import React from "react";
import "../css/crud.css";
import { Navbar, Nav, Container } from "react-bootstrap";
import axios from "axios";
import { Button, Modal, ModalBody, ModalHeader } from "reactstrap";
import Cookies from "universal-cookie";
import { ruta } from "../Ruta/ruta";
import logo from "../images/logo.png"
const baseUrl = ruta.baseUrl;
const cookies = new Cookies();
class crudCategoria extends React.Component {
  state = {
    modalInsert: false,
    msjModal: "",
    categoriaNombre: "",
    categoriaAntiguaId: "",
    categorias: [],
    categoriaAntigua: [],
  };
  componentDidMount() {
    if (!cookies.get("idUsuario")) {
      window.location.href = "/login";
    }
  }
  ocultarModal() {
    this.setState({ modalInsert: false });
  }

  handlechange = async (e) => {
    await this.setState({
      ...this.state,
      [e.target.name]: e.target.value,
    });
  };

  handlerChange = async (e) => {
    if (document.getElementById("titulosMod").value !== "0") {
      await this.setState({
        ...this.state,
        [e.target.name]: e.target.value,
      });
      this.state.categoriaAntigua = this.state.categorias.find((obj) => {
        return obj.idCategoria === parseInt(e.target.value);
      });
      this.state.categoriaAntiguaId = this.state.categoriaAntigua.idCategoria;
      document.getElementById(
        "categoriaMod"
      ).value = this.state.categoriaAntigua.Descripcion;
      this.state.categoriaNombre = this.state.categoriaAntigua.Descripcion;
    } else {
      document.getElementById("categoriaMod").value = "";
    }
  };

  insertarCategoria = async () => {
    if (this.state.categoriaNombre !== "") {
      const categoriaDB = {
        categoria: this.state.categoriaNombre,
      };
      await axios
        .post("http://localhost:9000/Categoria/add", categoriaDB)
        .then((res) => {
          this.state.msjModal = res.data;
        });

      this.setState({ modalInsert: true });
      this.ocultarDiv("ocultar");
      this.state.categoria = "";
      document.getElementById("categoriaID").value = "";
    } else {
      this.state.msjModal =
        "Por favor introduzca un valor en el campo necesario";
      this.setState({ modalInsert: true });
    }
  };

  actualizarCategoria = async () => {
    if (
      this.state.categoriaAntiguaId !== "" &&
      this.state.categoriaNombre !== "" &&
      document.getElementById("titulosMod").value !== "0"
    ) {
      const categoriaDB = {
        categoria: this.state.categoriaNombre,
        categoriaAntigua: this.state.categoriaAntiguaId,
      };
      await axios
        .post("http://localhost:9000/Categoria/update", categoriaDB)
        .then((res) => {
          this.state.msjModal = res.data;
          this.obtenerCategorias();
        });
      this.setState({ modalInsert: true });
      this.ocultarDiv("ocultar");
      this.state.categoria = "";
      document.getElementById("categoriaMod").value = "";
    } else {
      this.state.msjModal =
        "Por favor introduzca un valor en el campo necesario";
      this.setState({ modalInsert: true });
    }
  };

  eliminarCategoria = async () => {
    this.state.categoriaAntigua = this.state.categorias.find((obj) => {
      return obj.idCategoria === parseInt(this.state.categoriaNombre);
    });
    const categoriaDB = {
      categoria: this.state.categoriaNombre,
    };
    await axios.post(baseUrl + "Categoria/delete", categoriaDB).then((res) => {
      this.state.msjModal = res.data + this.state.categoriaAntigua.Descripcion;
      this.obtenerCategorias();
    });
    this.setState({ modalInsert: true });
    this.ocultarDiv("ocultar");
    this.state.categoriaNombre = "";
  };

  obtenerCategorias() {
    axios.get(baseUrl + "categorias/").then((res) => {
      this.setState({
        ...this.state,
        categorias: res.data,
      });
    });
  }

  ocultarDiv(str) {
    if (str === "agregar") {
      document.getElementById("divModificar").style.display = "none";
      document.getElementById("divEliminar").style.display = "none";
      document.getElementById("divAgregar").style.display = "block";
    } else if (str === "modificar") {
      this.obtenerCategorias();
      document.getElementById("titulosMod").value = "0";
      document.getElementById("divAgregar").style.display = "none";
      document.getElementById("divEliminar").style.display = "none";
      document.getElementById("divModificar").style.display = "block";
    } else if (str === "eliminar") {
      this.obtenerCategorias();
      document.getElementById("titulosDel").value = "0";
      document.getElementById("divAgregar").style.display = "none";
      document.getElementById("divModificar").style.display = "none";
      document.getElementById("divEliminar").style.display = "block";
    } else if (str === "ocultar") {
      document.getElementById("divAgregar").style.display = "none";
      document.getElementById("divModificar").style.display = "none";
      document.getElementById("divEliminar").style.display = "none";
    }
  }
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
                    <button id="btNavbar" onClick={() => this.cerrarSesion()}>
                      Cerrar sesión
                    </button>
                  </Nav.Link>
                </Nav>
              </Navbar.Collapse>
            </Container>
          </Navbar>
        </div>

        <div className="crud-container">
          <div className="TablaDatos">
            <h2>Categorías</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center", marginTop: "20px" }}>
              <input
                type="submit"
                id="confirmar"
                value="Agregar"
                onClick={() => this.ocultarDiv("agregar")}
              />
              <input
                type="submit"
                id="confirmar"
                value="Modificar"
                onClick={() => this.ocultarDiv("modificar")}
              />
              <input
                type="submit"
                id="confirmar"
                value="Eliminar"
                onClick={() => this.ocultarDiv("eliminar")}
              />
            </div>

            <hr style={{ marginTop: 30 }} />

            {/*-------------------------------------------------Div Opciones Agregar*/}
            <div
              className="divAgregar"
              id="divAgregar"
              style={{ display: "none" }}
            >
              <input
                type="text"
                className="categoria"
                id="categoriaID"
                placeholder="Nombre Categoría"
                name="categoriaNombre"
                onChange={this.handlechange}
                required
              />
              <br />
              <input
                type="submit"
                id="confirmar"
                value="Agregar"
                style={{ marginTop: 20 }}
                onClick={() => this.insertarCategoria()}
              />
            </div>

            {/*-------------------------------------------------Div Opciones Modificar*/}
            <div
              className="divModificar"
              id="divModificar"
              style={{ display: "none" }}
            >
              <select
                id="titulosMod"
                className="cbcategoria"
                name="categoriaAntigua"
                onChange={this.handlerChange}
              >
                <option value="0">Elije una Categoria a Modificar</option>
                {this.state.categorias.map((categoria, index) => (
                  <option key={index} value={categoria.idCategoria}>
                    {categoria.Descripcion}
                  </option>
                ))}
              </select>
              <br />
              <input
                type="text"
                className="categoria"
                placeholder="Nuevo Nombre"
                name="categoriaNombre"
                id="categoriaMod"
                onChange={this.handlechange}
              />
              <br />
              <input
                type="submit"
                id="confirmar"
                value="Modificar"
                style={{ marginTop: 20 }}
                onClick={() => this.actualizarCategoria()}
              />
            </div>

            {/*-------------------------------------------------Div Opciones Eliminar*/}
            <div
              className="divEliminar"
              id="divEliminar"
              style={{ display: "none" }}
            >
              <select
                id="titulosDel"
                className="cbcategoria"
                name="categoriaNombre"
                onChange={this.handlechange}
              >
                <option value="0">Elije una Categoria a Eliminar</option>
                {this.state.categorias.map((categoria, index) => (
                  <option key={index} value={categoria.idCategoria}>
                    {categoria.Descripcion}
                  </option>
                ))}
              </select>
              <br />
              <input
                type="submit"
                id="confirmar"
                value="Eliminar"
                style={{ marginTop: 20 }}
                onClick={() => this.eliminarCategoria()}
              />
            </div>
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

export default crudCategoria;
