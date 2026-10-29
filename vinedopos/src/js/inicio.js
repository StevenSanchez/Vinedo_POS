/**
 * ============================================================================
 * ARCHIVO: src/js/inicio.js
 * PROPÓSITO: pantalla pública de bienvenida ("La casa del Viñedo").
 * Muestra el logo y un botón que navega a /login. No consume el API.
 * ============================================================================
 */
import React from "react";
import "../css/inicio.css";
import logo2 from "../images/logo2.png";
import { NavLink } from "react-router-dom";

class inicio extends React.Component {
  render() {
    return (
      <div className="inicio-page">
        
        <div className="contenedor" id="contenedor">
          <h1 id="h1PI">La casa del Viñedo</h1>
          <div className="logo">
            <img id="logo2" src={logo2} alt="Imagen no se pudo cargar" />
          </div>
          <NavLink to="/login">
            <button id="a-login">Ingresar</button>
          </NavLink>
        </div>
      </div>
    );
  }
}

export default inicio;
