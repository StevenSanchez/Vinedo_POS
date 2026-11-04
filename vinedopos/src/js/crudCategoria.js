/**
 * ============================================================================
 * ARCHIVO: src/js/crudCategoria.js
 * PROPÓSITO: ABM de categorías del menú.
 *
 * ENDPOINTS:
 *   GET  /categorias/        listar
 *   POST /Categoria/add      insertar
 *   POST /Categoria/update   renombrar (categoriaAntigua = id)
 *   POST /Categoria/delete   borrar (categoria = id)
 * ============================================================================
 */
import React from "react";
import "../css/crud.css";
import "../css/catalogo.css";
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

class crudCategoria extends React.Component {
  state = {
    categorias: [],
    cargando: true,
    busqueda: "",
    modal: false,
    modo: "crear",
    editando: null,
    nombre: "",
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
      const res = await axios.get(baseUrl + "categorias/");
      this.setState({ categorias: res.data || [], cargando: false });
    } catch (e) {
      this.setState({ cargando: false });
      Swal.fire("Error", "No se pudieron cargar las categorías.", "error");
    }
  };

  abrirCrear = () => {
    this.setState({ modal: true, modo: "crear", editando: null, nombre: "" });
  };

  abrirEditar = (categoria) => {
    this.setState({
      modal: true,
      modo: "editar",
      editando: categoria,
      nombre: categoria.Descripcion || ""
    });
  };

  cerrarModal = () => {
    this.setState({ modal: false, guardando: false, editando: null, nombre: "" });
  };

  guardar = async () => {
    const nombre = (this.state.nombre || "").trim();
    if (!nombre) {
      Swal.fire("Falta el nombre", "Escriba el nombre de la categoría.", "warning");
      return;
    }
    this.setState({ guardando: true });
    try {
      const res =
        this.state.modo === "editar"
          ? await axios.post(baseUrl + "Categoria/update", {
              categoria: nombre,
              categoriaAntigua: this.state.editando.idCategoria
            })
          : await axios.post(baseUrl + "Categoria/add", { categoria: nombre });
      if (fueError(res.data)) throw new Error("respuesta");
      await this.cargar();
      this.cerrarModal();
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: this.state.modo === "editar" ? "Categoría actualizada" : "Categoría creada",
        showConfirmButton: false,
        timer: 1500
      });
    } catch (e) {
      this.setState({ guardando: false });
      Swal.fire("Error", "No se pudo guardar la categoría.", "error");
    }
  };

  eliminar = async (categoria) => {
    const confirmacion = await Swal.fire({
      title: "Eliminar categoría",
      html: "¿Eliminar <strong>" + (categoria.Descripcion || "") + "</strong>?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280"
    });
    if (!confirmacion.isConfirmed) return;
    try {
      const res = await axios.post(baseUrl + "Categoria/delete", {
        categoria: categoria.idCategoria
      });
      if (fueError(res.data)) {
        Swal.fire(
          "No se puede eliminar",
          "La categoría tiene productos asociados. Muévalos o elimínelos primero.",
          "error"
        );
        return;
      }
      await this.cargar();
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Categoría eliminada",
        showConfirmButton: false,
        timer: 1500
      });
    } catch (e) {
      Swal.fire(
        "No se puede eliminar",
        "La categoría tiene productos asociados o no está disponible.",
        "error"
      );
    }
  };

  cerrarSesion = () => {
    cookies.remove("idUsuario", { path: "/" });
    cookies.remove("usuario", { path: "/" });
    window.location.href = "/login";
  };

  render() {
    const { categorias, cargando, busqueda, modal, modo, nombre, guardando } = this.state;
    const q = busqueda.trim().toLowerCase();
    const filtradas = (categorias || []).filter((c) =>
      String(c.Descripcion || "").toLowerCase().includes(q)
    );

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
              <Navbar.Toggle aria-controls="categorias-nav" />
              <Navbar.Collapse id="categorias-nav">
                <Nav className="me-auto">
                  <Nav.Link href="/administracion">
                    <button className="btnNavbar">Administración</button>
                  </Nav.Link>
                  <Nav.Link href="/mesas">
                    <button className="btnNavbar">Mesas</button>
                  </Nav.Link>
                  <Nav.Link href="/crudProducto">
                    <button className="btnNavbar">Productos</button>
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
                <h2>Categorías</h2>
                <p className="config-sub">
                  Organiza el menú en categorías. Cada producto del catálogo pertenece a una.
                </p>
              </div>
              <div className="config-header-actions">
                <button type="button" className="btn btn-success btn-lg px-4" onClick={this.abrirCrear}>
                  <i className="bi bi-plus-lg"></i> Nueva categoría
                </button>
              </div>
            </div>

            <div className="catalog-toolbar">
              <div className="catalog-search">
                <i className="bi bi-search"></i>
                <input
                  type="text"
                  placeholder="Buscar categoría..."
                  value={busqueda}
                  onChange={(e) => this.setState({ busqueda: e.target.value })}
                />
              </div>
              <span className="catalog-count">
                {filtradas.length} de {(categorias || []).length} categorías
              </span>
            </div>

            {cargando ? (
              <p>Cargando categorías...</p>
            ) : filtradas.length === 0 ? (
              <div className="catalog-empty">
                <i className="bi bi-tags"></i>
                {q
                  ? "No hay categorías que coincidan con la búsqueda."
                  : "Todavía no hay categorías. Crea la primera con “Nueva categoría”."}
              </div>
            ) : (
              <div className="catalog-grid">
                {filtradas.map((categoria) => (
                  <div className="catalog-card" key={categoria.idCategoria}>
                    <div className="catalog-card-head">
                      <h3>
                        <i className="bi bi-tag" style={{ color: "#c9a7b2", marginRight: 6 }}></i>
                        {categoria.Descripcion}
                      </h3>
                    </div>
                    <div className="catalog-actions">
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        onClick={() => this.abrirEditar(categoria)}
                      >
                        <i className="bi bi-pencil"></i> Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-danger"
                        onClick={() => this.eliminar(categoria)}
                      >
                        <i className="bi bi-trash"></i> Eliminar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <Modal show={modal} onHide={this.cerrarModal} centered className="catalog-form">
          <Modal.Header closeButton>
            <Modal.Title>{modo === "editar" ? "Editar categoría" : "Nueva categoría"}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                this.guardar();
              }}
            >
              <Form.Group>
                <Form.Label>Nombre de la categoría</Form.Label>
                <Form.Control
                  autoFocus
                  type="text"
                  value={nombre}
                  maxLength={80}
                  placeholder="Ej. Entradas, Cortes Especiales..."
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

export default crudCategoria;
