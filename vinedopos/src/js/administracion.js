/**
 * ============================================================================
 * ARCHIVO: src/js/administracion.js
 * PROPÓSITO: menú de administración del POS.
 *
 * CONTENIDO:
 *  - Enlaces a: Categorías, Productos, Métodos de pago, Cargos/Servicio,
 *    Facturas, Ticket/Factura y Cierre de caja.
 *  - "Cierre de caja" navega a /cierre (Fase 3): resumen de pendientes,
 *    desglose por método, arqueo de efectivo, histórico e impresión.
 *    El cierre NO se ejecuta desde este menú.
 *
 * NOTA: la clase se llama `crudProducto` por copia/pega histórico; no afecta.
 * ============================================================================
 */
import React from "react";
import "../css/administracion.css";
import { Navbar, Nav, Container } from "react-bootstrap";
import Cookies from "universal-cookie";
import IpRed from "../components/IpRed";
import logo from "../images/logo.png";
const cookies = new Cookies();

class crudProducto extends React.Component {
  componentDidMount() {
    if (!cookies.get("idUsuario")) {
      window.location.href = "/login";
    }
  }

  cerrarSesion = () => {
    cookies.remove("idUsuario", { path: "/" });
    cookies.remove("usuario", { path: "/" });
    window.location.href = "/login";
  };

  irACierre = () => {
    window.location.href = "/cierre";
  };

  render() {
    return (
      <div className="App-body">
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
                  <Nav.Link href="/mesas">
                    <button id="btNavbar">Mesas</button>
                  </Nav.Link>
                  <Nav.Link>
                    <button id="btNavbar" onClick={this.irACierre}>
                      Cierre de caja
                    </button>
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

        <div className="admin-container">
          <div className="TablaBotones">
            <a href="/crudCategoria" className="btn" id="btAdmins">
              Categorías
            </a>
            <a href="/crudProducto" className="btn" id="btAdmins">
              Productos
            </a>
            <a href="/metodosPago" className="btn" id="btAdmins">
              Métodos de pago
            </a>
            <a href="/cargos" className="btn" id="btAdmins">
              Cargos / Servicio
            </a>
            <a href="/facturas" className="btn" id="btAdmins">
              Facturas
            </a>
            <a href="/configuracionTicket" className="btn" id="btAdmins">
              Ticket / Factura
            </a>
            <a href="/cierre" className="btn" id="btAdmins">
              Cierre de caja
            </a>
          </div>
        </div>
        <IpRed />
      </div>
    );
  }
}

export default crudProducto;
