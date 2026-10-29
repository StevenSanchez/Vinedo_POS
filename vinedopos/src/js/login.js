/**
 * ============================================================================
 * ARCHIVO: src/js/login.js
 * PROPÓSITO: inicio de sesión.
 *
 * FLUJO:
 *  1. Formulario controlado en state.form { usuario, contraseña }.
 *  2. inicioSesion() -> POST /Login/ con esas credenciales.
 *  3. Respuesta:
 *       "userName" -> el usuario no existe
 *       "password" -> contraseña incorrecta
 *       número     -> idUsuario correcto
 *  4. Guarda cookies `idUsuario` y `usuario` (path "/") y va a /mesas.
 *  5. Si ya hay cookie de sesión, redirige directo a /mesas.
 *
 * NOTA: la validación real ocurre en el API comparando texto plano; no hay
 * token ni sesión de servidor. Ver DOCUMENTACION_VINEDOPOS.md, sección 11.1.
 * ============================================================================
 */
import React from "react";
import "../css/login.css";
import logo2 from "../images/logo2.png";
import axios from 'axios';
import Cookies from 'universal-cookie';
import { ruta } from "../Ruta/ruta"
import Swal from "sweetalert2"
const baseUrl = ruta.baseUrl;
const cookies = new Cookies();

class login extends React.Component {

  state = {
    form: {
      usuario: '',
      contraseña: ''
    }
  }
  handlechange = async e => {
    await this.setState({
      form: {
        ...this.state.form,
        [e.target.name]: e.target.value
      }
    })
  }

  inicioSesion = async (e) => {
    if (e) e.preventDefault(); // Evita que la página se refresque
    const userTemp = this.state.form.usuario
    const user = { usuario: this.state.form.usuario, contraseña: this.state.form.contraseña }
    await axios.post(baseUrl + "login/", user)
      .then((res) => {
        if (res.data === "userName") {
          Swal.fire("El usuario no existe", "", "error")
        } else if (res.data === "password") {
          Swal.fire("Contrasela incorrecta", "", "error")
          //alert("La contraseña es incorrecta")
        }
        else {
          cookies.set('idUsuario', res.data, { path: "/" })
          cookies.set('usuario', userTemp, { path: "/" })
          //alert("Bienvenido " + userTemp)
          Swal.fire("Bienvenido", userTemp, "success").then((res) => { window.location.href = "/mesas"; })

        }
      })
      .catch(error => {
        console.log(error)
      })
    this.setState({ usuario: '', contraseña: '' })
  }

  componentDidMount() {
    if (cookies.get('idUsuario')) {
      window.location.href = "/mesas"
    }
  }

render() {
    return (
      <div className="login-page">
        {/* Cambiamos el div contenedor por un form */}
        <form 
          className="login-form" 
          id="login-form" 
          onSubmit={(e) => this.inicioSesion(e)}
        >
          <div className="logo">
            <img
              src={logo2}
              alt="Error al cargar imagen"
              width="100"
              height="100"
              id="logo"
            />
          </div>

          <h1 id="titulo">La casa del Viñedo</h1>
          <input
            className="INLG"
            type="text"
            name="usuario"
            placeholder="Usuario"
            autoFocus
            onChange={this.handlechange}
            required
          />
          <input
            className="INLG"
            type="password"
            name="contraseña"
            placeholder="Contraseña"
            onChange={this.handlechange}
            required
          />

          {/* Cambiamos onClick por type="submit" */}
          <button id="btn-login" type="submit">Login</button>
        </form>
      </div>
    );
  }
}

export default login;
