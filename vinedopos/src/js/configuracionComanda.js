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

class ConfiguracionComanda extends React.Component {
  state = {
    config: {
      titulo: "COMANDA",
      ancho_mm: 80,
      tamano_fuente: 9,
      mostrar_fecha: 1,
      mostrar_hora: 1,
      mostrar_mesa: 1,
      mostrar_cliente: 1,
      mostrar_cantidad: 1,
      mostrar_guarniciones: 1,
      mostrar_termino: 1,
      agrupar_por_estacion: 0,
      leyenda_pie: ""
    },
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
    try {
      const [resConfig, resCat] = await Promise.all([
        axios.get(baseUrl + "configuracion/comanda"),
        axios.get(baseUrl + "categoria-impresion/cocina")
      ]);
      this.setState({
        config: { ...this.state.config, ...(resConfig.data || {}) },
        categorias: resCat.data || [],
        cargando: false
      });
    } catch (e) {
      console.log(e);
      this.setState({ cargando: false });
    }
  };

  handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let nuevo = type === "checkbox" ? (checked ? 1 : 0) : value;
    if (["ancho_mm", "tamano_fuente"].includes(name)) {
      nuevo = value === "" ? "" : Number(value);
    }
    this.setState({ config: { ...this.state.config, [name]: nuevo } });
  };

  toggleCategoria = (id) => {
    const categorias = (this.state.categorias || []).map((c) =>
      c.idCategoria === id ? { ...c, imprimir_cocina: c.imprimir_cocina ? 0 : 1 } : c
    );
    this.setState({ categorias });
  };

  guardar = async () => {
    this.setState({ guardando: true });
    try {
      await axios.put(baseUrl + "configuracion/comanda", this.state.config);
      await axios.post(baseUrl + "categoria-impresion/cocina", {
        items: this.state.categorias
      });
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Configuración guardada",
        showConfirmButton: false,
        timer: 1600
      });
    } catch (e) {
      Swal.fire("Error", "No se pudo guardar la configuración.", "error");
    } finally {
      this.setState({ guardando: false });
    }
  };

  check = (campo, etiqueta) => (
    <label className="ticket-check" key={campo}>
      <input
        type="checkbox"
        name={campo}
        checked={Number(this.state.config[campo]) === 1 || this.state.config[campo] === true}
        onChange={this.handleChange}
      />
      <span>{etiqueta}</span>
    </label>
  );

  render() {
    const { config, categorias, cargando, guardando } = this.state;
    const seleccionadas = (categorias || []).filter(
      (c) => Number(c.imprimir_cocina) === 1 || c.imprimir_cocina === true
    ).length;

    return (
      <div className="App-body">
        <div>
          <Navbar collapseOnSelect expand="lg" bg="dark" variant="dark">
            <Container>
              <Navbar.Brand href="/administracion" className="d-flex align-items-center gap-2">
                <img src={logo} alt="" width="35" height="35" />
                <span>VinedoPos</span>
              </Navbar.Brand>
              <Navbar.Toggle aria-controls="comanda-nav" />
              <Navbar.Collapse id="comanda-nav">
                <Nav className="me-auto">
                  <Nav.Link href="/mesas">
                    <button className="btnNavbar">Mesas</button>
                  </Nav.Link>
                  <Nav.Link href="/administracion">
                    <button className="btnNavbar">Administración</button>
                  </Nav.Link>
                  <Nav.Link href="/configuracionModificadores">
                    <button className="btnNavbar">Guarniciones y Términos</button>
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
                <h2>Comanda de Cocina</h2>
                <p className="config-sub">
                  Define cómo se imprime la comanda que recibe cocina y qué categorías de
                  productos deben salir en ella.
                </p>
              </div>
              <div className="config-header-actions">
                <button
                  type="button"
                  className="btn btn-success btn-lg px-4"
                  onClick={this.guardar}
                  disabled={guardando}
                >
                  {guardando ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>
            </div>

            {cargando ? (
              <p>Cargando...</p>
            ) : (
              <div>
                <div className="config-section">
                  <h4 className="config-section-title">
                    <i className="bi bi-sliders"></i> Ajustes de impresión
                  </h4>
                  <div className="ticket-fila">
                    <div className="ticket-campo">
                      <label>Título de la comanda</label>
                      <input
                        type="text"
                        name="titulo"
                        value={config.titulo || ""}
                        onChange={this.handleChange}
                        placeholder="COMANDA"
                      />
                    </div>
                    <div className="ticket-campo">
                      <label>Ancho del papel</label>
                      <select name="ancho_mm" value={config.ancho_mm} onChange={this.handleChange}>
                        <option value={80}>80 mm</option>
                        <option value={58}>58 mm</option>
                      </select>
                    </div>
                    <div className="ticket-campo">
                      <label>Tamaño de fuente (8 a 25)</label>
                      <input
                        type="number"
                        min="8"
                        max="25"
                        name="tamano_fuente"
                        value={config.tamano_fuente}
                        onChange={this.handleChange}
                      />
                      <small className="text-muted">Puede subir hasta 25 para probar.</small>
                    </div>
                  </div>

                  <div className="config-subtitle">Datos que se imprimen</div>
                  <div className="ticket-checks">
                    {this.check("mostrar_fecha", "Fecha")}
                    {this.check("mostrar_hora", "Hora")}
                    {this.check("mostrar_mesa", "Mesa")}
                    {this.check("mostrar_cliente", "Cliente")}
                    {this.check("mostrar_cantidad", "Cantidad")}
                    {this.check("mostrar_guarniciones", "Guarniciones")}
                    {this.check("mostrar_termino", "Término")}
                    {this.check("agrupar_por_estacion", "Agrupar por estación")}
                  </div>

                  <div className="ticket-campo" style={{ marginTop: "14px" }}>
                    <label>Leyenda al pie</label>
                    <textarea
                      name="leyenda_pie"
                      rows="2"
                      value={config.leyenda_pie || ""}
                      onChange={this.handleChange}
                      placeholder="Texto opcional que aparece al final de la comanda"
                    />
                  </div>
                </div>

                <div className="config-section">
                  <div className="config-section-head">
                    <h4 className="config-section-title" style={{ margin: 0 }}>
                      <i className="bi bi-fire"></i> Categorías que van a cocina
                    </h4>
                    <span className="config-badge">{seleccionadas} seleccionadas</span>
                  </div>
                  <p className="config-sub" style={{ marginBottom: 0 }}>
                    Solo los productos de estas categorías se imprimen en la comanda.
                  </p>
                  <div className="categoria-cocina-grid">
                    {(categorias || []).map((cat) => {
                      const activa =
                        Number(cat.imprimir_cocina) === 1 || cat.imprimir_cocina === true;
                      return (
                        <label
                          key={cat.idCategoria}
                          className={"cat-toggle" + (activa ? " activa" : "")}
                        >
                          <input
                            type="checkbox"
                            checked={activa}
                            onChange={() => this.toggleCategoria(cat.idCategoria)}
                          />
                          <span>{cat.Descripcion}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default ConfiguracionComanda;
