import React from "react";
import "../css/crud.css";
import { Navbar, Nav, Container } from "react-bootstrap";
import axios from "axios";
import Cookies from "universal-cookie";
import Swal from "sweetalert2";
import { ruta } from "../Ruta/ruta";
import logo from "../images/logo.png";

const baseUrl = ruta.baseUrl;
const cookies = new Cookies();

const grupoVacio = () => ({
  GrupoID: 0,
  Nombre: "",
  Tipo: "radio",
  Obligatorio: 1,
  SoloInterno: 0,
  Orden: 0,
  Activo: 1,
  CobrarPrecio: 1,
  Categorias: [],
  CategoriasOrigen: [],
  Items: []
});

const itemVacio = (orden) => ({
  ItemID: 0,
  Nombre: "",
  PrecioExtra: 0,
  Orden: orden,
  Activo: 1
});

const normalizarGrupo = (g) => ({
  GrupoID: Number(g.GrupoID) || 0,
  Nombre: g.Nombre || "",
  Tipo: g.Tipo === "checkbox" ? "checkbox" : g.Tipo === "max2" ? "max2" : "radio",
  Obligatorio: Number(g.Obligatorio) === 1 ? 1 : 0,
  SoloInterno: Number(g.SoloInterno) === 1 ? 1 : 0,
  Orden: Number(g.Orden) || 0,
  Activo: g.Activo === undefined ? 1 : Number(g.Activo) === 1 ? 1 : 0,
  CobrarPrecio: g.CobrarPrecio === undefined ? 1 : Number(g.CobrarPrecio) === 1 ? 1 : 0,
  Categorias: (g.Categorias || []).map((c) => Number(c)),
  CategoriasOrigen: (g.CategoriasOrigen || []).map((c) => Number(c)),
  Items: (g.Items || []).map((i) => ({
    ItemID: Number(i.ItemID) || 0,
    ProductoID: i.ProductoID ? Number(i.ProductoID) : null,
    idCategoria: i.idCategoria ? Number(i.idCategoria) : null,
    Nombre: i.Nombre || "",
    PrecioProducto: Number(i.PrecioProducto) || 0,
    PrecioExtra: Number(i.PrecioExtra) || 0,
    Orden: Number(i.Orden) || 0,
    Activo: i.Activo === undefined ? 1 : Number(i.Activo) === 1 ? 1 : 0,
    Origen: i.Origen || "manual"
  }))
});

class ConfiguracionModificadores extends React.Component {
  state = {
    grupos: [],
    categorias: [],
    cargando: true,
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
      const [resGrupos, resCategorias] = await Promise.all([
        axios.get(baseUrl + "modificadores/grupos"),
        axios.get(baseUrl + "categorias/")
      ]);
      this.setState({
        grupos: (resGrupos.data || []).map(normalizarGrupo),
        categorias: resCategorias.data || [],
        cargando: false
      });
    } catch (e) {
      console.log(e);
      this.setState({ cargando: false });
      Swal.fire("Error", "No se pudieron cargar los grupos de modificadores.", "error");
    }
  };

  nuevoGrupo = () => {
    this.setState({ grupos: [...this.state.grupos, grupoVacio()] });
  };

  cambiarGrupo = (indice, campo, valor) => {
    const grupos = this.state.grupos.map((g, i) => {
      if (i !== indice) return g;
      const nuevo = { ...g, [campo]: valor };
      if (campo === "CobrarPrecio") {
        nuevo.Items = (g.Items || []).map((it) => ({
          ...it,
          PrecioExtra: valor ? Number(it.PrecioProducto) || 0 : 0
        }));
      }
      return nuevo;
    });
    this.setState({ grupos });
  };

  cargarOpcionesProductos = async (categorias, cobrarPrecio) => {
    if (!categorias || categorias.length === 0) return [];
    const respuestas = await Promise.all(
      categorias.map((id) =>
        axios
          .post(baseUrl + "productos/", { categoriaID: id })
          .then((res) => res.data || [])
          .catch(() => [])
      )
    );
    const opciones = [];
    respuestas.forEach((productos) => {
      (productos || []).forEach((p) => {
        if (opciones.some((o) => Number(o.ProductoID) === Number(p.codigo))) return;
        opciones.push({
          ItemID: p.codigo,
          ProductoID: p.codigo,
          idCategoria: p.idCategoria,
          Nombre: p.nombre,
          PrecioProducto: Number(p.precio) || 0,
          PrecioExtra: cobrarPrecio ? Number(p.precio) || 0 : 0,
          Orden: opciones.length + 1,
          Activo: 1,
          Origen: "producto"
        });
      });
    });
    return opciones;
  };

  alternarCategoria = (indice, idCategoria) => {
    const grupos = this.state.grupos.map((g, i) => {
      if (i !== indice) return g;
      const existe = g.Categorias.includes(idCategoria);
      return {
        ...g,
        Categorias: existe
          ? g.Categorias.filter((c) => c !== idCategoria)
          : [...g.Categorias, idCategoria]
      };
    });
    this.setState({ grupos });
  };

  alternarOrigen = async (indice, idCategoria) => {
    const grupo = this.state.grupos[indice];
    if (!grupo) return;
    const existe = grupo.CategoriasOrigen.includes(idCategoria);
    const nuevas = existe
      ? grupo.CategoriasOrigen.filter((c) => c !== idCategoria)
      : [...grupo.CategoriasOrigen, idCategoria];

    const grupos = this.state.grupos.map((g, i) =>
      i === indice ? { ...g, CategoriasOrigen: nuevas } : g
    );

    if (nuevas.length === 0) {
      this.setState({
        grupos: grupos.map((g, i) => (i === indice ? { ...g, Items: [] } : g))
      });
      return;
    }

    // Se muestran de inmediato las opciones de las categorías elegidas.
    this.setState({ grupos });
    const opciones = await this.cargarOpcionesProductos(nuevas, grupo.CobrarPrecio);
    this.setState((prev) => ({
      grupos: prev.grupos.map((g, i) => (i === indice ? { ...g, Items: opciones } : g))
    }));
  };

  agregarItem = (indiceGrupo) => {
    const grupos = this.state.grupos.map((g, i) =>
      i === indiceGrupo ? { ...g, Items: [...g.Items, itemVacio(g.Items.length + 1)] } : g
    );
    this.setState({ grupos });
  };

  cambiarItem = (indiceGrupo, indiceItem, campo, valor) => {
    const grupos = this.state.grupos.map((g, i) => {
      if (i !== indiceGrupo) return g;
      return {
        ...g,
        Items: g.Items.map((it, j) => (j === indiceItem ? { ...it, [campo]: valor } : it))
      };
    });
    this.setState({ grupos });
  };

  quitarItem = async (indiceGrupo, indiceItem) => {
    const grupo = this.state.grupos[indiceGrupo];
    const item = grupo.Items[indiceItem];
    if (item && item.ItemID) {
      const confirmacion = await Swal.fire({
        title: "Eliminar ítem",
        text: item.Nombre || "Este ítem",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Eliminar",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#ef4444"
      });
      if (!confirmacion.isConfirmed) return;
      try {
        await axios.post(baseUrl + "modificadores/item/delete", { ItemID: item.ItemID });
      } catch (e) {
        Swal.fire("Error", "No se pudo eliminar el ítem.", "error");
        return;
      }
    }
    const grupos = this.state.grupos.map((g, i) =>
      i === indiceGrupo ? { ...g, Items: g.Items.filter((_, j) => j !== indiceItem) } : g
    );
    this.setState({ grupos });
  };

  guardarGrupo = async (indice) => {
    const grupo = this.state.grupos[indice];
    if (!grupo) return;
    if (!grupo.Nombre.trim()) {
      Swal.fire("Falta el nombre", "Escriba un nombre para el grupo.", "warning");
      return;
    }
    this.setState({ guardando: true });
    try {
      const res = await axios.post(baseUrl + "modificadores/grupo", {
        GrupoID: grupo.GrupoID || 0,
        Nombre: grupo.Nombre.trim(),
        Tipo: grupo.Tipo,
        Obligatorio: grupo.Obligatorio ? 1 : 0,
        SoloInterno: grupo.SoloInterno ? 1 : 0,
        Orden: Number(grupo.Orden) || 0,
        Activo: grupo.Activo ? 1 : 0,
        CobrarPrecio: grupo.CobrarPrecio ? 1 : 0,
        Categorias: grupo.Categorias,
        CategoriasOrigen: grupo.CategoriasOrigen
      });
      const grupoID = Number(res.data && res.data.GrupoID) || grupo.GrupoID;

      // Si las opciones vienen de categorías de productos, no se guardan
      // ítems manuales: la lista se calcula desde los productos.
      if (grupo.CategoriasOrigen.length === 0) {
        for (let j = 0; j < grupo.Items.length; j++) {
          const item = grupo.Items[j];
          if (!item.Nombre || !item.Nombre.trim()) continue;
          await axios.post(baseUrl + "modificadores/item", {
            ItemID: item.ItemID || 0,
            GrupoID: grupoID,
            Nombre: item.Nombre.trim(),
            PrecioExtra: Number(item.PrecioExtra) || 0,
            Orden: Number(item.Orden) || j + 1
          });
        }
      }

      await this.cargar();
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Grupo guardado",
        showConfirmButton: false,
        timer: 1500
      });
    } catch (e) {
      console.log(e);
      const mensaje =
        (e && e.response && e.response.data && e.response.data.error) ||
        "No se pudo guardar el grupo.";
      Swal.fire("Error", mensaje, "error");
    } finally {
      this.setState({ guardando: false });
    }
  };

  eliminarGrupo = async (indice) => {
    const grupo = this.state.grupos[indice];
    if (!grupo) return;
    if (!grupo.GrupoID) {
      this.setState({ grupos: this.state.grupos.filter((_, i) => i !== indice) });
      return;
    }
    const confirmacion = await Swal.fire({
      title: "Eliminar grupo",
      html:
        "Se eliminará <strong>" +
        (grupo.Nombre || "el grupo") +
        "</strong> con sus asignaciones.<br/>Las líneas ya guardadas conservan su texto.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444"
    });
    if (!confirmacion.isConfirmed) return;
    try {
      await axios.post(baseUrl + "modificadores/grupo/delete", { GrupoID: grupo.GrupoID });
      await this.cargar();
    } catch (e) {
      Swal.fire("Error", "No se pudo eliminar el grupo.", "error");
    }
  };

  renderCategoriasDestino = (grupo, indice) => (
    <div className="mod-categorias">
      <div className="mod-etiqueta">Mostrar este grupo en estas categorías</div>
      <div className="mod-categorias-grid">
        {(this.state.categorias || []).map((cat) => (
          <label key={cat.idCategoria} className="mod-cat-check">
            <input
              type="checkbox"
              checked={grupo.Categorias.includes(Number(cat.idCategoria))}
              onChange={() => this.alternarCategoria(indice, Number(cat.idCategoria))}
            />
            <span>{cat.Descripcion}</span>
          </label>
        ))}
      </div>
    </div>
  );

  renderCategoriasOrigen = (grupo, indice) => (
    <div className="mod-categorias">
      <div className="mod-etiqueta">Opciones tomadas de estas categorías de productos</div>
      <div className="mod-categorias-grid">
        {(this.state.categorias || []).map((cat) => (
          <label key={cat.idCategoria} className="mod-cat-check">
            <input
              type="checkbox"
              checked={grupo.CategoriasOrigen.includes(Number(cat.idCategoria))}
              onChange={() => this.alternarOrigen(indice, Number(cat.idCategoria))}
            />
            <span>{cat.Descripcion}</span>
          </label>
        ))}
      </div>
      <div className="mod-nota">
        Si elige una o varias categorías, las opciones serán los productos de esas
        categorías (no se crean productos nuevos). Si no elige ninguna, se usan las
        opciones manuales de abajo.
      </div>
    </div>
  );

  renderItemsManuales = (grupo, indice) => (
    <div className="mod-items">
      <div className="mod-etiqueta">Opciones manuales</div>
      <table className="table table-sm mod-tabla">
        <thead>
          <tr>
            <th style={{ width: "50%" }}>Nombre</th>
            <th style={{ width: "20%" }}>Precio extra</th>
            <th style={{ width: "15%" }}>Orden</th>
            <th style={{ width: "15%" }}></th>
          </tr>
        </thead>
        <tbody>
          {grupo.Items.map((item, indiceItem) => (
            <tr key={item.ItemID || "nuevo-" + indiceItem}>
              <td>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="Ej. Término medio"
                  value={item.Nombre}
                  onChange={(e) => this.cambiarItem(indice, indiceItem, "Nombre", e.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="form-control form-control-sm"
                  value={item.PrecioExtra}
                  onChange={(e) =>
                    this.cambiarItem(indice, indiceItem, "PrecioExtra", e.target.value)
                  }
                />
              </td>
              <td>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={item.Orden}
                  onChange={(e) => this.cambiarItem(indice, indiceItem, "Orden", e.target.value)}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  onClick={() => this.quitarItem(indice, indiceItem)}
                  title="Quitar ítem"
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </td>
            </tr>
          ))}
          {grupo.Items.length === 0 && (
            <tr>
              <td colSpan="4" className="text-muted">
                Todavía no hay opciones. Agregue la primera.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        onClick={() => this.agregarItem(indice)}
      >
        <i className="bi bi-plus-lg"></i> Agregar opción
      </button>
      <div className="mod-nota">
        <i className="bi bi-info-circle"></i> El precio extra se suma al precio del producto.
        Déjelo en 0 si la opción va incluida con el plato.
      </div>
    </div>
  );

  renderItemsProductos = (grupo) => (
    <div className="mod-items">
      <div className="mod-etiqueta">Opciones que salen de las categorías seleccionadas</div>
      <table className="table table-sm mod-tabla">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Categoría</th>
            <th>Precio que se suma</th>
          </tr>
        </thead>
        <tbody>
          {grupo.Items.map((item, i) => (
            <tr key={item.ItemID || i}>
              <td>{item.Nombre}</td>
              <td>
                {(this.state.categorias.find(
                  (c) => Number(c.idCategoria) === Number(item.idCategoria)
                ) || {}).Descripcion || "-"}
              </td>
              <td>₡ {Number(item.PrecioExtra || 0)}</td>
            </tr>
          ))}
          {grupo.Items.length === 0 && (
            <tr>
              <td colSpan="3" className="text-muted">
                Las categorías elegidas todavía no tienen productos.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="mod-nota">
        Esta lista se actualiza sola con los productos de las categorías elegidas.
      </div>
    </div>
  );

  renderGrupo = (grupo, indice) => {
    const usaProductos = grupo.CategoriasOrigen.length > 0;
    return (
      <div className="card mod-card" key={grupo.GrupoID || "nuevo-" + indice}>
        <div className="card-body">
          <div className="mod-card-cabecera">
            <input
              type="text"
              className="mod-nombre"
              placeholder="Nombre del grupo (ej. Guarniciones, Término)"
              value={grupo.Nombre}
              onChange={(e) => this.cambiarGrupo(indice, "Nombre", e.target.value)}
            />
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              onClick={() => this.eliminarGrupo(indice)}
              title="Eliminar grupo"
            >
              <i className="bi bi-trash"></i>
            </button>
          </div>

          <div className="mod-opciones">
            <label className="mod-campo">
              <span>Tipo de selección</span>
              <select
                value={grupo.Tipo}
                onChange={(e) => this.cambiarGrupo(indice, "Tipo", e.target.value)}
              >
                <option value="radio">Una sola opción</option>
                <option value="max2">Hasta 2 opciones</option>
                <option value="checkbox">Varias opciones</option>
              </select>
            </label>
            <label className="mod-campo">
              <span>Orden</span>
              <input
                type="number"
                value={grupo.Orden}
                onChange={(e) => this.cambiarGrupo(indice, "Orden", e.target.value)}
              />
            </label>
            <label className="mod-check">
              <input
                type="checkbox"
                checked={Boolean(grupo.Obligatorio)}
                onChange={(e) => this.cambiarGrupo(indice, "Obligatorio", e.target.checked ? 1 : 0)}
              />
              <span>Selección obligatoria</span>
            </label>
            <label className="mod-check">
              <input
                type="checkbox"
                checked={Boolean(grupo.SoloInterno)}
                onChange={(e) => this.cambiarGrupo(indice, "SoloInterno", e.target.checked ? 1 : 0)}
              />
              <span>Solo cocina (no sale al cliente)</span>
            </label>
            <label className="mod-check">
              <input
                type="checkbox"
                checked={Boolean(grupo.Activo)}
                onChange={(e) => this.cambiarGrupo(indice, "Activo", e.target.checked ? 1 : 0)}
              />
              <span>Activo</span>
            </label>
            {usaProductos && (
              <label className="mod-check">
                <input
                  type="checkbox"
                  checked={Boolean(grupo.CobrarPrecio)}
                  onChange={(e) =>
                    this.cambiarGrupo(indice, "CobrarPrecio", e.target.checked ? 1 : 0)
                  }
                />
                <span>Sumar el precio del producto al plato</span>
              </label>
            )}
          </div>

          {this.renderCategoriasDestino(grupo, indice)}
          {this.renderCategoriasOrigen(grupo, indice)}
          {usaProductos ? this.renderItemsProductos(grupo) : this.renderItemsManuales(grupo, indice)}

          <div className="mod-acciones">
            <button
              type="button"
              className="btn btn-success"
              onClick={() => this.guardarGrupo(indice)}
              disabled={this.state.guardando}
            >
              {this.state.guardando ? "Guardando..." : "Guardar grupo"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  render() {
    const { grupos, cargando } = this.state;
    return (
      <div className="App-body">
        <div>
          <Navbar collapseOnSelect expand="lg" bg="dark" variant="dark">
            <Container>
              <Navbar.Brand href="/administracion">
                <img src={logo} alt="" width="35" height="35" /> <span>VinedoPos</span>
              </Navbar.Brand>
              <Navbar.Toggle aria-controls="modificadores-nav" />
              <Navbar.Collapse id="modificadores-nav">
                <Nav className="me-auto">
                  <Nav.Link href="/mesas">
                    <button className="btnNavbar">Mesas</button>
                  </Nav.Link>
                  <Nav.Link href="/administracion">
                    <button className="btnNavbar">Administración</button>
                  </Nav.Link>
                  <Nav.Link href="/configuracionComanda">
                    <button className="btnNavbar">Comanda de Cocina</button>
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
                <h2>Guarniciones y Términos</h2>
                <p className="config-sub">
                  Cree grupos de opciones y decida de dónde salen. Para guarniciones, elija las
                  categorías de productos que las contienen; para términos, use opciones manuales.
                  Luego marque en qué categorías debe aparecer el grupo.
                </p>
              </div>
              <div className="config-header-actions">
                <button
                  type="button"
                  className="btn btn-success btn-lg px-4"
                  onClick={this.nuevoGrupo}
                >
                  <i className="bi bi-plus-lg"></i> Nuevo grupo
                </button>
              </div>
            </div>

            {cargando ? (
              <p>Cargando...</p>
            ) : (
              <div className="mod-lista">
                {grupos.length === 0 && (
                  <div className="alert alert-info">
                    No hay grupos configurados. Cree uno con el botón{" "}
                    <strong>Nuevo grupo</strong>.
                  </div>
                )}
                {grupos.map((grupo, indice) => this.renderGrupo(grupo, indice))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default ConfiguracionModificadores;
