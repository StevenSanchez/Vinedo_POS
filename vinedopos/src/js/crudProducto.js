/**
 * ============================================================================
 * ARCHIVO: src/js/crudProducto.js
 * PROPÓSITO: ABM de productos del catálogo.
 *
 * ENDPOINTS:
 *   GET  /categorias/         llenar el selector de categorías
 *   POST /productos/          productos de una categoría ({ categoriaID })
 *   POST /Productos/add/      insertar
 *   POST /Producto/actualizar actualizar nombre/descripcion/precio
 *   POST /Producto/delete     borrar por codigo
 * ============================================================================
 */
import React from "react";
import "../css/crud.css";
import "../css/catalogo.css";
import { Navbar, Nav, Container, Modal, Button, Form, Row, Col } from "react-bootstrap";
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

const formVacio = (categoria) => ({
  nombre: "",
  descripcion: "",
  precio: "",
  categoria: Number(categoria) || 0
});

const money = (valor) =>
  Number(valor || 0).toLocaleString("es-CR", { maximumFractionDigits: 2 });

class crudProducto extends React.Component {
  state = {
    categorias: [],
    productos: [],
    categoriaSeleccionada: 0,
    cargando: false,
    busqueda: "",
    modal: false,
    modo: "crear",
    editando: null,
    form: formVacio(0),
    guardando: false
  };

  componentDidMount() {
    if (!cookies.get("idUsuario")) {
      window.location.href = "/login";
      return;
    }
    this.cargarCategorias();
  }

  cargarCategorias = async () => {
    try {
      const res = await axios.get(baseUrl + "categorias/");
      const categorias = res.data || [];
      const actual =
        Number(this.state.categoriaSeleccionada) ||
        (categorias[0] ? Number(categorias[0].idCategoria) : 0);
      this.setState({ categorias, categoriaSeleccionada: actual });
      if (actual) await this.cargarProductos(actual);
    } catch (e) {
      Swal.fire("Error", "No se pudieron cargar las categorías.", "error");
    }
  };

  cargarProductos = async (idCategoria) => {
    const categoriaID = Number(idCategoria) || 0;
    if (!categoriaID) {
      this.setState({ productos: [], cargando: false });
      return;
    }
    this.setState({ cargando: true });
    try {
      const res = await axios.post(baseUrl + "productos/", { categoriaID });
      this.setState({ productos: res.data || [], cargando: false });
    } catch (e) {
      this.setState({ productos: [], cargando: false });
      Swal.fire("Error", "No se pudieron cargar los productos.", "error");
    }
  };

  cambiarCategoria = (e) => {
    const id = Number(e.target.value) || 0;
    this.setState({ categoriaSeleccionada: id, busqueda: "" });
    this.cargarProductos(id);
  };

  abrirCrear = () => {
    const categoria =
      this.state.categoriaSeleccionada ||
      (this.state.categorias[0] ? this.state.categorias[0].idCategoria : 0);
    this.setState({
      modal: true,
      modo: "crear",
      editando: null,
      form: formVacio(categoria)
    });
  };

  abrirEditar = (producto) => {
    this.setState({
      modal: true,
      modo: "editar",
      editando: producto,
      form: {
        nombre: producto.nombre || "",
        descripcion: producto.descripcion || "",
        precio: producto.precio != null ? String(producto.precio) : "",
        categoria: Number(producto.idCategoria) || this.state.categoriaSeleccionada
      }
    });
  };

  cerrarModal = () => {
    this.setState({ modal: false, guardando: false, editando: null, form: formVacio(0) });
  };

  cambiarCampo = (campo, valor) => {
    this.setState({ form: { ...this.state.form, [campo]: valor } });
  };

  guardar = async () => {
    const { form, modo, editando } = this.state;
    const nombre = (form.nombre || "").trim();
    const descripcion = (form.descripcion || "").trim();
    const precio = Number(form.precio);
    const categoria = Number(form.categoria);

    if (!nombre) {
      Swal.fire("Falta el nombre", "Escriba el nombre del producto.", "warning");
      return;
    }
    if (form.precio === "" || Number.isNaN(precio) || precio < 0) {
      Swal.fire("Precio inválido", "Ingrese un precio de 0 o mayor.", "warning");
      return;
    }
    if (!categoria) {
      Swal.fire("Falta la categoría", "Seleccione una categoría.", "warning");
      return;
    }

    this.setState({ guardando: true });
    try {
      const res =
        modo === "editar"
          ? await axios.post(baseUrl + "Producto/actualizar", {
              codigo: editando.codigo,
              nombre,
              descripcion,
              precio,
              idCategoria: categoria
            })
          : await axios.post(baseUrl + "Productos/add/", {
              nombreProducto: nombre,
              descripcionProducto: descripcion,
              precioProducto: precio,
              categoria
            });
      if (fueError(res.data)) throw new Error("respuesta");
      this.setState({
        modal: false,
        guardando: false,
        editando: null,
        form: formVacio(0),
        categoriaSeleccionada: categoria
      });
      await this.cargarProductos(categoria);
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: modo === "editar" ? "Producto actualizado" : "Producto creado",
        showConfirmButton: false,
        timer: 1500
      });
    } catch (e) {
      this.setState({ guardando: false });
      Swal.fire("Error", "No se pudo guardar el producto.", "error");
    }
  };

  eliminar = async (producto) => {
    const confirmacion = await Swal.fire({
      title: "Eliminar producto",
      html: "¿Eliminar <strong>" + (producto.nombre || "") + "</strong>?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280"
    });
    if (!confirmacion.isConfirmed) return;
    try {
      const res = await axios.post(baseUrl + "Producto/delete", {
        idProducto: producto.codigo
      });
      if (fueError(res.data)) {
        Swal.fire(
          "No se puede eliminar",
          "Este producto ya se usó en pedidos. Puede dejar de venderlo cambiando su categoría o precio.",
          "error"
        );
        return;
      }
      await this.cargarProductos(this.state.categoriaSeleccionada);
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Producto eliminado",
        showConfirmButton: false,
        timer: 1500
      });
    } catch (e) {
      Swal.fire(
        "No se puede eliminar",
        "El producto ya se usó en pedidos o no está disponible.",
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
    const {
      categorias,
      productos,
      categoriaSeleccionada,
      cargando,
      busqueda,
      modal,
      modo,
      form,
      guardando
    } = this.state;

    const categoriaActual = (categorias || []).find(
      (c) => Number(c.idCategoria) === Number(categoriaSeleccionada)
    );
    const q = busqueda.trim().toLowerCase();
    const filtrados = (productos || []).filter(
      (p) =>
        String(p.nombre || "").toLowerCase().includes(q) ||
        String(p.descripcion || "").toLowerCase().includes(q)
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
              <Navbar.Toggle aria-controls="productos-nav" />
              <Navbar.Collapse id="productos-nav">
                <Nav className="me-auto">
                  <Nav.Link href="/administracion">
                    <button className="btnNavbar">Administración</button>
                  </Nav.Link>
                  <Nav.Link href="/mesas">
                    <button className="btnNavbar">Mesas</button>
                  </Nav.Link>
                  <Nav.Link href="/crudCategoria">
                    <button className="btnNavbar">Categorías</button>
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
                <h2>Productos</h2>
                <p className="config-sub">
                  Catálogo de productos por categoría. El precio se usa al agregar el producto a
                  una cuenta.
                </p>
              </div>
              <div className="config-header-actions">
                <button
                  type="button"
                  className="btn btn-success btn-lg px-4"
                  onClick={this.abrirCrear}
                  disabled={categorias.length === 0}
                >
                  <i className="bi bi-plus-lg"></i> Nuevo producto
                </button>
              </div>
            </div>

            <div className="catalog-toolbar">
              <div className="catalog-filter">
                <label htmlFor="categoria-filtro">Categoría</label>
                <select
                  id="categoria-filtro"
                  value={categoriaSeleccionada}
                  onChange={this.cambiarCategoria}
                >
                  {(categorias || []).map((categoria) => (
                    <option key={categoria.idCategoria} value={categoria.idCategoria}>
                      {categoria.Descripcion}
                    </option>
                  ))}
                </select>
              </div>

              <div className="catalog-search">
                <i className="bi bi-search"></i>
                <input
                  type="text"
                  placeholder="Buscar producto..."
                  value={busqueda}
                  onChange={(e) => this.setState({ busqueda: e.target.value })}
                />
              </div>

              <span className="catalog-count">
                {filtrados.length} de {(productos || []).length} productos
              </span>
            </div>

            {cargando ? (
              <p>Cargando productos...</p>
            ) : filtrados.length === 0 ? (
              <div className="catalog-empty">
                <i className="bi bi-box-seam"></i>
                {categorias.length === 0
                  ? "Primero crea una categoría para poder agregar productos."
                  : q
                  ? "No hay productos que coincidan con la búsqueda."
                  : categoriaActual
                  ? "Esta categoría todavía no tiene productos."
                  : "Seleccione una categoría."}
              </div>
            ) : (
              <div className="catalog-grid">
                {filtrados.map((producto) => (
                  <div className="catalog-card" key={producto.codigo}>
                    <div className="catalog-card-head">
                      <h3>{producto.nombre}</h3>
                      <span className="catalog-badge">{categoriaActual ? categoriaActual.Descripcion : "Sin categoría"}</span>
                    </div>
                    <div className="catalog-price">₡ {money(producto.precio)}</div>
                    <p className={"catalog-desc" + (producto.descripcion ? "" : " vacia")}>
                      {producto.descripcion || "Sin descripción"}
                    </p>
                    <div className="catalog-actions">
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        onClick={() => this.abrirEditar(producto)}
                      >
                        <i className="bi bi-pencil"></i> Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-danger"
                        onClick={() => this.eliminar(producto)}
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
            <Modal.Title>{modo === "editar" ? "Editar producto" : "Nuevo producto"}</Modal.Title>
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
                  value={form.nombre}
                  maxLength={80}
                  placeholder="Ej. Lomito, Imperial..."
                  onChange={(e) => this.cambiarCampo("nombre", e.target.value)}
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Descripción</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  value={form.descripcion}
                  maxLength={180}
                  placeholder="Descripción breve (opcional)"
                  onChange={(e) => this.cambiarCampo("descripcion", e.target.value)}
                />
              </Form.Group>

              <Row className="g-3">
                <Col xs={12} sm={6}>
                  <Form.Group>
                    <Form.Label>Precio</Form.Label>
                    <Form.Control
                      type="number"
                      min="0"
                      step="any"
                      value={form.precio}
                      placeholder="0"
                      onChange={(e) => this.cambiarCampo("precio", e.target.value)}
                    />
                  </Form.Group>
                </Col>
                <Col xs={12} sm={6}>
                  <Form.Group>
                    <Form.Label>Categoría</Form.Label>
                    <Form.Select
                      value={form.categoria}
                      onChange={(e) => this.cambiarCampo("categoria", e.target.value)}
                    >
                      <option value="0">Seleccione categoría</option>
                      {(categorias || []).map((categoria) => (
                        <option key={categoria.idCategoria} value={categoria.idCategoria}>
                          {categoria.Descripcion}
                        </option>
                      ))}
                    </Form.Select>
                    <Form.Text>
                      Puede mover el producto a otra categoría al editarlo.
                    </Form.Text>
                  </Form.Group>
                </Col>
              </Row>
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

export default crudProducto;
