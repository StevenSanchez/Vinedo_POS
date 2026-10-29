/**
 * ============================================================================
 * ARCHIVO: src/js/crudProducto.js
 * PROPÓSITO: ABM de productos del catálogo.
 *
 * ENDPOINTS:
 *   GET  /categorias/        llenar el selector de categorías
 *   POST /productos/         productos de una categoría ({ categoriaID })
 *   POST /Productos/add      insertar
 *   POST /Producto/actualizar actualizar nombre/descripcion/precio
 *   POST /Producto/delete    borrar por codigo
 *
 * COMPORTAMIENTO:
 *  - Al elegir una categoría se recargan sus productos.
 *  - El update NO cambia la categoría de un producto existente.
 *  - `precio` es el precio de catálogo; las cuentas ya creadas conservan su
 *    lineafactura.Precio (override por línea).
 *  - Si el producto está usado en lineafactura, el borrado falla por FK y se
 *    muestra el error crudo de MySQL.
 *
 * ESTILO: legado imperativo (document.getElementById + style.display +
 * banderas titulos1/titulos2/titulosAdd para saber qué panel está activo).
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
class crudProducto extends React.Component {
  state = {
    modalInsert: false,
    nombreProducto: "",
    descripcionProducto: "",
    precioProducto: 0,
    idProducto: 0,
    categoria: 0,
    categorias: [],
    productos: [],
    producto: [],
  };

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
    this.obtenerProductos(e.target.value);
  };

  handlerProducto = async (e) => {
    if (document.getElementById("titulos2").value !== "0") {
      await this.setState({
        ...this.state,
        [e.target.name]: e.target.value,
      });
      this.state.producto = this.state.productos.find((obj) => {
        return obj.codigo === parseInt(e.target.value);
      });
      this.state.nombreProducto = this.state.producto.nombre;
      this.state.descripcionProducto = this.state.producto.descripcion;
      this.state.precioProducto = this.state.producto.precio;
      document.getElementById(
        "nombreProducto"
      ).value = this.state.producto.nombre;
      document.getElementById(
        "descripcionProducto"
      ).value = this.state.producto.descripcion;
      document.getElementById(
        "precioProducto"
      ).value = this.state.producto.precio;
    } else {
      document.getElementById("nombreProducto").value = "";
      document.getElementById("descripcionProducto").value = "";
      document.getElementById("precioProducto").value = "";
    }
  };
  cerrarSesion = () => {
    cookies.remove("idUsuario", { path: "/" });
    cookies.remove("usuario", { path: "/" });
    window.location.href = "/login";
  };
  ocultarDiv(str) {
    if (str === "agregar") {
      document.getElementById("titulosAdd").value = "0";
      document.getElementById("nombreProductoAdd").value = "";
      document.getElementById("descripcionProductoAdd").value = "";
      document.getElementById("precioProductoAdd").value = "";
      document.getElementById("divModificar").style.display = "none";
      document.getElementById("divEliminar").style.display = "none";
      document.getElementById("divAgregar").style.display = "block";
    } else if (str === "modificar") {
      document.getElementById("titulos1").value = "0";
      document.getElementById("titulos2").value = "0";
      document.getElementById("nombreProducto").value = "";
      document.getElementById("descripcionProducto").value = "";
      document.getElementById("precioProducto").value = "";
      document.getElementById("divAgregar").style.display = "none";
      document.getElementById("divEliminar").style.display = "none";
      document.getElementById("divModificar").style.display = "block";
    } else if (str === "eliminar") {
      document.getElementById("titulos1Del").value = "0";
      document.getElementById("titulos2Del").value = "0";
      document.getElementById("divAgregar").style.display = "none";
      document.getElementById("divModificar").style.display = "none";
      document.getElementById("divEliminar").style.display = "block";
    } else if (str === "ocultar") {
      document.getElementById("divAgregar").style.display = "none";
      document.getElementById("divModificar").style.display = "none";
      document.getElementById("divEliminar").style.display = "none";
    }
  }

  obtenerCategorias() {
    axios.get(baseUrl + "categorias/").then((res) => {
      this.setState({
        ...this.state,
        categorias: res.data,
      });
    });
  }

  obtenerProductos(categoriaID) {
    document.getElementById("titulos2").value = "0";
    document.getElementById("nombreProducto").value = "";
    document.getElementById("descripcionProducto").value = "";
    document.getElementById("precioProducto").value = "";
    const categoriaDB = {
      categoriaID: categoriaID,
    };
    axios.post(baseUrl + "productos/", categoriaDB).then((res) => {
      this.setState({
        ...this.state,
        productos: res.data,
      });
    });
  }

  insertarProducto = async () => {
    if (
      document.getElementById("titulosAdd").value !== "0" &&
      this.state.nombreProducto !== "" &&
      this.state.descripcionProducto !== "" &&
      this.state.precioProducto !== ""
    ) {
      const productoDB = {
        nombreProducto: this.state.nombreProducto,
        descripcionProducto: this.state.descripcionProducto,
        precioProducto: this.state.precioProducto,
        categoria: this.state.categoria,
      };
      await axios.post(baseUrl + "Productos/add/", productoDB).then((res) => {
        this.state.msjModal = res.data;
        this.ocultarDiv("ocultar");
      });
      this.setState({ modalInsert: true });
    } else {
      this.state.msjModal = "Por favor introduzca valores en todos los campos";
      this.setState({ modalInsert: true });
    }
  };

  eliminarProducto = async () => {
    if (
      document.getElementById("titulos1Del").value !== "0" &&
      document.getElementById("titulos2Del").value !== "0"
    ) {
      const productoDB = {
        idProducto: this.state.idProducto,
      };
      await axios.post(baseUrl + "Producto/delete", productoDB).then((res) => {
        this.state.msjModal = res.data;
        this.obtenerCategorias();
        this.state.productos = [];
      });
      document.getElementById("titulos1Del").value = "0";
      document.getElementById("titulos2Del").value = "0";
      this.setState({ modalInsert: true });
      this.ocultarDiv("ocultar");
    } else {
      this.state.msjModal = "Favor elegir el producto a eliminar";
      this.setState({ modalInsert: true });
    }
  };

  actualizarProductos = async () => {
    if (
      document.getElementById("titulos1").value !== "0" &&
      document.getElementById("titulos2").value !== "0" &&
      this.state.idProducto !== "" &&
      this.state.nombreProducto !== "" &&
      this.state.descripcionProducto !== "" &&
      this.state.precioProducto !== ""
    ) {
      const productoDB = {
        codigo: this.state.idProducto,
        nombre: this.state.nombreProducto,
        descripcion: this.state.descripcionProducto,
        precio: this.state.precioProducto,
      };
      await axios
        .post(baseUrl + "Producto/actualizar", productoDB)
        .then((res) => {
          this.state.msjModal = res.data;
        });
      document.getElementById("titulos1").value = "0";
      document.getElementById("titulos2").value = "0";
      this.state.idProducto = "";
      this.state.nombreProducto = "";
      this.state.descripcionProducto = "";
      this.state.precioProducto = "";
      this.setState({ modalInsert: true });
      this.ocultarDiv("ocultar");
    } else {
      this.state.msjModal = "Por favor introduzca valores en todos los campos";
      this.setState({ modalInsert: true });
    }
  };

  componentDidMount() {
    if (!cookies.get("idUsuario")) {
      window.location.href = "/login";
    } else {
      this.obtenerCategorias();
    }
  }

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
          <div className="TablaDatos" style={{ maxWidth: "900px" }}>
            <h2>Productos</h2>
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
            <form>
              <input
                id="nombreProductoAdd"
                name="nombreProducto"
                type="text"
                className="name"
                placeholder="Nombre"
                onChange={this.handlechange}
                required
              />
              <br />
              <textarea
                id="descripcionProductoAdd"
                name="descripcionProducto"
                type="text"
                className="desc"
                placeholder="Descripción"
                style={{ marginTop: 20 }}
                onChange={this.handlechange}
                required
              />
              <br />
              <input
                id="precioProductoAdd"
                name="precioProducto"
                type="number"
                className="price"
                placeholder="Precio"
                style={{ marginTop: 20 }}
                onChange={this.handlechange}
                required
              />
              <br />
              <select
                id="titulosAdd"
                className="cbcategoria"
                name="categoria"
                style={{ marginTop: 20 }}
                onChange={this.handlechange}
              >
                <option value="0">Elije una Categoria</option>
                {this.state.categorias.map((categoria) => (
                  <option value={categoria.idCategoria}>
                    {categoria.Descripcion}
                  </option>
                ))}
              </select>
              <br />
            </form>
            <input
              type="submit"
              id="confirmar"
              value="Agregar Producto"
              style={{ marginTop: 20 }}
              onClick={() => this.insertarProducto()}
            />
          </div>

          {/*-------------------------------------------------Div Opciones Modificar*/}
          <div
            className="divModificar"
            id="divModificar"
            style={{ display: "none" }}
          >
            <select
              id="titulos1"
              className="cbcategoria"
              name="categoria"
              style={{ marginTop: 20 }}
              onChange={this.handlerChange}
            >
              <option value="0">Elije una Categoria</option>
              {this.state.categorias.map((categoria) => (
                <option value={categoria.idCategoria}>
                  {categoria.Descripcion}
                </option>
              ))}
            </select>
            <br />
            <select
              id="titulos2"
              className="cbcategoria"
              name="idProducto"
              style={{ marginTop: 20 }}
              onChange={this.handlerProducto}
            >
              <option value="0">Elije un Producto</option>
              {this.state.productos.map((producto) => (
                <option value={producto.codigo}>{producto.nombre}</option>
              ))}
            </select>

            <form>
              <br />
              <input
                id="nombreProducto"
                name="nombreProducto"
                type="text"
                className="name"
                placeholder="Nombre"
                onChange={this.handlechange}
                required
              />
              <br />
              <textarea
                id="descripcionProducto"
                name="descripcionProducto"
                type="text"
                className="desc"
                placeholder="Descripción"
                style={{ marginTop: 20 }}
                onChange={this.handlechange}
                required
              />
              <br />
              <input
                id="precioProducto"
                name="precioProducto"
                type="number"
                className="price"
                placeholder="Precio"
                style={{ marginTop: 20 }}
                onChange={this.handlechange}
                required
              />
              <br />
            </form>
            <input
              type="submit"
              id="confirmar"
              value="Modificar Producto"
              style={{ marginTop: 20 }}
              onClick={() => this.actualizarProductos()}
            />
          </div>

          {/*-------------------------------------------------Div Opciones Eliminar*/}
          <div
            className="divEliminar"
            id="divEliminar"
            style={{ display: "none" }}
          >
            <select
              id="titulos1Del"
              className="cbcategoria"
              name="categoria"
              style={{ marginTop: 20 }}
              onChange={this.handlerChange}
            >
              <option value="0">Elegir Categoria</option>
              {this.state.categorias.map((categoria) => (
                <option value={categoria.idCategoria}>
                  {categoria.Descripcion}
                </option>
              ))}
            </select>
            <br />
            <select
              id="titulos2Del"
              className="cbcategoria"
              name="idProducto"
              style={{ marginTop: 20 }}
              onChange={this.handlechange}
            >
              <option value="0">Elegir Producto</option>
              {this.state.productos.map((producto) => (
                <option value={producto.codigo}>{producto.nombre}</option>
              ))}
            </select>
            <br />
            <input
              type="submit"
              id="confirmar"
              value="Eliminar Producto"
              style={{ marginTop: 20 }}
              onClick={() => this.eliminarProducto()}
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

export default crudProducto;
