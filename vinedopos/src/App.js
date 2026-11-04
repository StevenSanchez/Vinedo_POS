/**
 * ============================================================================
 * ARCHIVO: src/App.js
 * PROPÓSITO: mapa de rutas del frontend (react-router-dom v6).
 *
 * Rutas:
 *   /                     Inicio (bienvenida)
 *   /login                Login
 *   /pedidos              Cuenta de la mesa seleccionada
 *   /mesas                Mapa de mesas
 *   /crudCategoria        ABM de categorías
 *   /crudProducto         ABM de productos
 *   /administracion       Menú de administración
 *   /metodosPago          ABM de métodos de pago
 *   /cargos               ABM de cargos por porcentaje
 *   /facturas             Histórico de facturas
 *   /configuracionTicket  Editor del machote del ticket
 *
 * Para agregar una pantalla: crear el componente en src/js, importarlo aquí
 * y agregar su <Route>. Ver DOCUMENTACION_VINEDOPOS.md, receta 12.6.
 * ============================================================================
 */
import React from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import Inicio from "./js/inicio";
import Login from "./js/login";
import Pedidos from "./js/pedidos";
import Mesas from "./js/mesas";
import ModificarCategoria from "./js/crudCategoria";
import ModificarProducto from "./js/crudProducto";
import Administracion from "./js/administracion";
import MetodosPago from "./js/metodosPago";
import Cargos from "./js/cargos";
import Facturas from "./js/facturas";
import ConfiguracionTicket from "./js/configuracionTicket";
import ConfiguracionComanda from "./js/configuracionComanda";
import ConfiguracionModificadores from "./js/configuracionModificadores";
import Cierre from "./js/cierre";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/login" element={<Login />} />
        <Route path="/pedidos" element={<Pedidos />} />
        <Route path="/mesas" element={<Mesas />} />
        <Route path="/crudCategoria" element={<ModificarCategoria />} />
        <Route path="/crudProducto" element={<ModificarProducto />} />
        <Route path="/administracion" element={<Administracion />} />
        <Route path="/metodosPago" element={<MetodosPago />} />
        <Route path="/cargos" element={<Cargos />} />
        <Route path="/facturas" element={<Facturas />} />
        <Route path="/configuracionTicket" element={<ConfiguracionTicket />} />
        <Route path="/configuracionComanda" element={<ConfiguracionComanda />} />
        <Route path="/configuracionModificadores" element={<ConfiguracionModificadores />} />
        <Route path="/cierre" element={<Cierre />} />
      </Routes>
    </Router>
  );
}
