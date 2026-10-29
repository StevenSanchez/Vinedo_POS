/**
 * ============================================================================
 * ARCHIVO: src/Ruta/ruta.js
 * PROPÓSITO: centralizar la URL base del API.
 *
 * Usa el hostname desde el que se abrió el frontend y el puerto fijo 9000.
 * Ejemplos:
 *   http://localhost:3000      -> http://localhost:9000/
 *   http://10.0.0.2:3000       -> http://10.0.0.2:9000/
 *
 * Si el API cambia de puerto o de host, este es el único lugar a editar
 * (excepto dos URLs viejas hardcodeadas en src/js/crudCategoria.js).
 * ============================================================================
 */
const hostname = window.location.hostname;
export const ruta = {
    baseUrl: "http://" + hostname + ":9000/"
}