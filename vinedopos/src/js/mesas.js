/**
 * ============================================================================
 * ARCHIVO: src/js/mesas.js
 * PROPÓSITO: mapa de mesas libres/ocupadas y selección de mesa.
 *
 * CÓMO SABE SI UNA MESA ESTÁ OCUPADA:
 *   Cruza GET /mesas/ con GET /mesas/use/ (facturas con estado = 1).
 *   Agrupa TODAS las facturas abiertas por MesaID, porque una mesa puede
 *   tener varias cuentas (una factura por cuenta). Pinta el botón como
 *   ocupado e indica cuántas cuentas tiene. No hay columna de estado en `mesa`.
 *
 * ACTUALIZACIÓN:
 *   - Polling cada 5 segundos.
 *   - Refresco al recuperar foco de la ventana y al volver a la pestaña.
 *   - Limpia intervalo y listeners en componentWillUnmount.
 *
 * SISTEMA DE REORDENAMIENTO: DRAG & DROP
 *   - Arrastrar y soltar filas para reordenar las mesas.
 *   - El orden se guarda automáticamente al soltar.
 *
 * ACCIONES:
 *   - Clic en mesa: guarda el objeto de la mesa en la cookie `MesaID`
 *     (MesaID, Nombre, FacturaID de referencia, cuentas, estado...) y navega
 *     a /pedidos. Pedidos vuelve a consultar las cuentas reales al abrir.
 *   - Arrastrar y soltar: reordenar mesas.
 *   - Agregar mesa: POST /mesas/add/
 *   - Eliminar mesa: POST /mesas/delete/ (bloqueado si hay cuentas abiertas)
 * ============================================================================
 */
import React from "react";
import "bootstrap/dist/css/bootstrap.min.css"
import 'bootstrap-icons/font/bootstrap-icons.css';
import "../css/mesas.css";
import IpRed from "../components/IpRed";
import axios from "axios";
import Cookies from 'universal-cookie';
import { Navbar, Nav, Container, NavDropdown, Modal, Button, Form } from 'react-bootstrap'
import { ruta } from "../Ruta/ruta"
import DropdownItem from "react-bootstrap/esm/DropdownItem";
import Swal from "sweetalert2";
import logo from "../images/logo.png";
const baseUrl = ruta.baseUrl;
const cookies = new Cookies();

class mesas extends React.Component {
  state = {
    mesasDB: [],
    mesasOcupadas: [],
    nombreMN: '',
    modalInsert: false,
    modalRename: false,
    mesaRename: null,
    nombreRename: '',
    guardandoRename: false,
    dragIndex: null,
    dragOverIndex: null
  }

  setearVacio() {
    this.setState({
      mesasDB: [],
      mesasOcupadas: [],
      nombreMN: '',
      modalInsert: false,
      modalRename: false,
      mesaRename: null,
      nombreRename: '',
      guardandoRename: false,
      dragIndex: null,
      dragOverIndex: null
    })
  }

  cerrarSesion = () => {
    this.setearVacio()
    cookies.remove('idUsuario', { path: "/" })
    cookies.remove('usuario', { path: "/" })
    window.location.href = "/login"
  }

  refrescarmesas = async () => {
    const mesasTemp = await axios.get(baseUrl + "mesas/")
    const facturasTemp = await axios.get(baseUrl + "mesas/use/")
    const mesas = mesasTemp.data
    const facturasEnUso = facturasTemp.data || []
    
    const cuentasPorMesa = {}
    for (let j = 0; j < facturasEnUso.length; j++) {
      const factura = facturasEnUso[j]
      if (Number(factura.estado) !== 1) continue
      if (!cuentasPorMesa[factura.MesaID]) {
        cuentasPorMesa[factura.MesaID] = []
      }
      cuentasPorMesa[factura.MesaID].push(factura)
    }
    
    var lista = []
    for (let i = 0; i < mesas.length; i++) {
      const cuentas = cuentasPorMesa[mesas[i].MesaID] || []
      const primera = cuentas[0]
      var mesaTemp = {
        MesaID: mesas[i].MesaID,
        Nombre: mesas[i].Nombre,
        FacturaID: primera ? primera.FacturaID : null,
        Hora: primera ? primera.Hora : null,
        Fecha: primera ? primera.Fecha : null,
        estado: primera ? primera.estado : null,
        cuentas: cuentas.length,
        botonID: cuentas.length > 0 ? "btMesaUse" : "btMesa",
        orden: mesas[i].orden || i + 1
      }
      lista.push(mesaTemp)
    }
    
    this.setState({ mesasDB: lista })
  }

  componentDidMount() {
    if (!cookies.get('idUsuario')) {
      window.location.href = "/login"
    } else {
      this.refrescarmesas()
      this._refreshInterval = setInterval(() => {
        this.refrescarmesas()
      }, 5000)
      this._onFocus = () => {
        this.refrescarmesas()
      }
      this._onVisibility = () => {
        if (document.visibilityState === 'visible') {
          this.refrescarmesas()
        }
      }
      window.addEventListener('focus', this._onFocus)
      document.addEventListener('visibilitychange', this._onVisibility)
    }
  }

  componentWillUnmount() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval)
      this._refreshInterval = null
    }
    if (this._onFocus) {
      window.removeEventListener('focus', this._onFocus)
    }
    if (this._onVisibility) {
      document.removeEventListener('visibilitychange', this._onVisibility)
    }
  }

  redirectPage(mesa) {
    cookies.set('MesaID', mesa, { path: "/" })
    this.setearVacio()
    window.location.href = "/pedidos"
  }

  mostrarModal() {
    this.setState({ modalInsert: true })
  }

  handleChange = e => {
    this.setState({
      ...this.state,
      [e.target.name]: e.target.value
    })
  }

  ocultarModal() {
    this.setState({ modalInsert: false, nombreMN: '' })
  }

  insertarMesa = async () => {
    const newMesa = { mesa: this.state.nombreMN }
    await axios.post(baseUrl + "mesas/add/", newMesa)
      .then((res) => {
        Swal.fire(res.data, "", "info")
      })
    this.setState({ modalInsert: false, nombreMN: '' })
    this.refrescarmesas()
  }

  mostrarModalRename = (mesa) => {
    if (!mesa) return
    this.setState({
      modalRename: true,
      mesaRename: mesa,
      nombreRename: mesa.Nombre || "",
      guardandoRename: false
    })
  }

  ocultarModalRename = () => {
    if (this.state.guardandoRename) return
    this.setState({
      modalRename: false,
      mesaRename: null,
      nombreRename: "",
      guardandoRename: false
    })
  }

  renombrarMesa = async () => {
    const mesa = this.state.mesaRename
    const nombre = (this.state.nombreRename || "").trim()
    if (!mesa) return
    if (nombre === "") {
      Swal.fire("Falta el nombre", "Escriba el nombre de la mesa.", "warning")
      return
    }
    if (nombre.length > 25) {
      Swal.fire("Nombre muy largo", "Máximo 25 caracteres.", "warning")
      return
    }
    if (nombre === mesa.Nombre) {
      this.ocultarModalRename()
      return
    }
    this.setState({ guardandoRename: true })
    try {
      await axios.post(baseUrl + "mesas/rename/", {
        MesaID: mesa.MesaID,
        nombre
      })
      this.setState({
        modalRename: false,
        mesaRename: null,
        nombreRename: "",
        guardandoRename: false
      })
      await this.refrescarmesas()
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Mesa renombrada",
        showConfirmButton: false,
        timer: 1600
      })
    } catch (error) {
      this.setState({ guardandoRename: false })
      const mensaje =
        (error.response && error.response.data && error.response.data.error) ||
        "No se pudo renombrar la mesa."
      Swal.fire("No se renombró", mensaje, "warning")
    }
  }

  guardarOrden = async (mesasOrdenadas) => {
    const ordenes = (mesasOrdenadas || this.state.mesasDB || []).map((mesa, index) => ({
      MesaID: mesa.MesaID,
      orden: index + 1
    }))
    try {
      await axios.post(baseUrl + "mesas/ordenar", { ordenes })
    } catch (e) {
      // Ignorar errores para no interrumpir el uso
    }
  }

  onDragStart = (e, index) => {
    this.setState({ dragIndex: index })
    e.dataTransfer.effectAllowed = "move"
  }

  onDragOver = (e, index) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    if (this.state.dragIndex === index) return
    this.setState({ dragOverIndex: index })
  }

  onDragLeave = () => {
    this.setState({ dragOverIndex: null })
  }

  onDrop = (e, dropIndex) => {
    e.preventDefault()
    const { dragIndex, mesasDB } = this.state
    if (dragIndex === null || dragIndex === dropIndex) {
      this.setState({ dragIndex: null, dragOverIndex: null })
      return
    }
    
    const mesasReordenadas = [...mesasDB]
    const [movedMesa] = mesasReordenadas.splice(dragIndex, 1)
    mesasReordenadas.splice(dropIndex, 0, movedMesa)
    
    this.setState({ mesasDB: mesasReordenadas, dragIndex: null, dragOverIndex: null }, () => {
      this.guardarOrden(mesasReordenadas)
    })
  }

  onDragEnd = () => {
    this.setState({ dragIndex: null, dragOverIndex: null })
  }

  eliminarmesa = async (mesa) => {
    if (Number(mesa.cuentas || 0) > 0) {
      Swal.fire(
        "Mesa con cuentas abiertas",
        mesa.Nombre + " tiene " + mesa.cuentas + " cuenta(s) abierta(s). Cóbrelas o elimínelas antes de borrar la mesa.",
        "warning"
      )
      return
    }
    const confirmacion = await Swal.fire({
      title: "¿Eliminar " + mesa.Nombre + "?",
      text: "Esta acción no se puede deshacer.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280"
    })
    if (!confirmacion.isConfirmed) return
    const mes = { MesaID: mesa.MesaID }
    try {
      const resp = await axios.post(baseUrl + "mesas/delete/", mes)
      Swal.fire(typeof resp.data === "string" ? resp.data : "Mesa eliminada", "", "success")
      this.refrescarmesas()
    } catch (error) {
      const mensaje =
        (error.response && error.response.data && error.response.data.error) ||
        "No se pudo eliminar la mesa."
      Swal.fire("No se eliminó la mesa", mensaje, "warning")
    }
  }

  render() {
    return (
      <body className="App-body">
        <div>
          <Navbar collapseOnSelect expand="lg" bg="dark" variant="dark">
            <Container>
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
              <Navbar.Toggle aria-controls="responsive-navbar-nav" />
              <Navbar.Collapse id="responsive-navbar-nav">
                <Nav className="me-auto">
                  <Nav.Link href="/administracion">
                    <button className="btnNavbar" >Administración</button>
                  </Nav.Link>
                  <Nav.Link>
                    <button className="btnNavbar" onClick={() => this.mostrarModal()}>Agregar Mesa</button>
                  </Nav.Link>
                  <NavDropdown title="Renombrar mesa">
                    {this.state.mesasDB.map((mesa, index) => (
                      <DropdownItem key={index} onClick={() => this.mostrarModalRename(mesa)}>{mesa.Nombre}</DropdownItem>
                    ))}
                  </NavDropdown>
                  <NavDropdown title="Eliminar mesa">
                    {this.state.mesasDB.map((mesa, index) => (
                      <DropdownItem key={index} onClick={() => this.eliminarmesa(mesa)}>{mesa.Nombre}</DropdownItem>
                    ))}
                  </NavDropdown>
                </Nav>
                <Nav>
                  <Nav.Link>
                    <button className="btnNavbar" onClick={() => this.cerrarSesion()}>Cerrar sesión</button>
                  </Nav.Link>
                </Nav>
              </Navbar.Collapse>
            </Container>
          </Navbar>
        </div>
        <div className="TablaMesas">
          <table id="tbMesas">
            {this.state.mesasDB.map((mesa, index) => (
              <div
                key={mesa.MesaID}
                draggable
                onDragStart={(e) => this.onDragStart(e, index)}
                onDragOver={(e) => this.onDragOver(e, index)}
                onDragLeave={this.onDragLeave}
                onDrop={(e) => this.onDrop(e, index)}
                onDragEnd={this.onDragEnd}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  minWidth: 0,
                  cursor: this.state.dragIndex === index ? 'grabbing' : 'grab',
                  opacity: this.state.dragIndex === index ? 0.5 : 1,
                  border: this.state.dragOverIndex === index && this.state.dragIndex !== index ? '2px dashed #198754' : '2px solid transparent',
                  borderRadius: '12px',
                  transition: 'all 0.15s ease'
                }}
              >
                <button
                  className={mesa.botonID}
                  style={{ flex: 1, minWidth: 0 }}
                  onClick={() => {
                    if (this.state.dragIndex === null) {
                      this.redirectPage(mesa)
                    }
                  }}
                  title={mesa.cuentas > 0 ? mesa.Nombre + " · " + mesa.cuentas + " cuenta(s)" : mesa.Nombre}
                >
                  {mesa.Nombre}
                  {mesa.cuentas > 1 && (
                    <span className="mesa-cuentas">{mesa.cuentas} cuentas</span>
                  )}
                </button>
              </div>
            ))}
          </table>
        </div>
        <Modal show={this.state.modalInsert} onHide={() => this.ocultarModal()} centered className="mesa-modal">
          <Modal.Header closeButton>
            <Modal.Title><i className="bi bi-plus-circle"></i> Agregar mesa</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group>
              <Form.Label className="mesa-label">Nombre de la mesa</Form.Label>
              <Form.Control name="nombreMN" type="text" placeholder="Ej. Mesa 10" value={this.state.nombreMN || ''} onChange={this.handleChange} autoFocus />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => this.ocultarModal()}>Cancelar</Button>
            <Button variant="success" onClick={() => this.insertarMesa()}><i className="bi bi-check-lg"></i> Guardar</Button>
          </Modal.Footer>
        </Modal>
        <Modal show={this.state.modalRename} onHide={() => this.ocultarModalRename()} centered className="mesa-modal">
          <Modal.Header closeButton>
            <Modal.Title><i className="bi bi-pencil"></i> Renombrar mesa</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group>
              <Form.Label className="mesa-label">Nuevo nombre</Form.Label>
              <Form.Control
                name="nombreRename"
                type="text"
                maxLength={25}
                placeholder="Ej. Terraza 1"
                value={this.state.nombreRename || ''}
                onChange={this.handleChange}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    this.renombrarMesa()
                  }
                }}
              />
              <Form.Text className="text-muted">
                Se actualizarán también las cuentas abiertas de esta mesa.
              </Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => this.ocultarModalRename()}>Cancelar</Button>
            <Button variant="success" onClick={() => this.renombrarMesa()} disabled={this.state.guardandoRename}>
              {this.state.guardandoRename ? "Guardando…" : "Guardar"}
            </Button>
          </Modal.Footer>
        </Modal>
        <IpRed />
      </body>
    );
  }
}

export default mesas;
