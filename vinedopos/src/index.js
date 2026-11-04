/**
 * ============================================================================
 * ARCHIVO: src/index.js
 * PROPÓSITO: punto de entrada del frontend React.
 * Monta <App /> dentro de #root (definido en public/index.html) usando
 * ReactDOM.createRoot y React.StrictMode (modo desarrollo de React 18).
 * No contiene lógica de negocio.
 * ============================================================================
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./css/responsive.css";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
