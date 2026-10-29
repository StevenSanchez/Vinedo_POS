/**
 * ============================================================================
 * ARCHIVO: src/js/pedidos.js
 * PROPÓSITO: pantalla central del POS. Administra la cuenta de una mesa:
 * productos, cantidades, precio por línea, cargos, cliente, prefactura,
 * cobro mixto y ticket.
 *
 * ESTADO PRINCIPAL (state):
 *   factura            líneas en memoria {codigo, Nombre, Precio, Cantidad,
 *                      Subtotal, LineaFacturaID, FacturaID}
 *   idFactura          factura abierta actual (0 = aún no existe)
 *   mesaActual         nombre de la mesa (cookie MesaID)
 *   total              total calculado = suma líneas + cargos
 *   cargosDisponibles  catálogo activo (GET /cargos/)
 *   cargosAplicados    cargos de esta cuenta (con idFacturaCargo si están en BD)
 *   cliente            cliente guardado en factura.Cliente
 *   pagos / vuelto     cobro mixto (vuelto solo de efectivo)
 *   configTicket       machote cargado con obtenerConfigTicket()
 *
 * FLUJO DE GUARDADO:
 *   - Primer producto: reutiliza la factura abierta si existe; si no,
 *     POST /factura/add/; guarda cargos predeterminados y la línea.
 *   - Producto repetido: suma cantidad a la línea existente (mismo `codigo`)
 *     conservando el precio especial de esa línea.
 *   - Cada cambio se persiste de inmediato en lineafactura.
 *   - El total se calcula en el cliente; se persiste en factura.Total al
 *     pulsar Cobrar.
 *
 * MÉTODOS CLAVE:
 *   cargarFactura, agregarALista, eliminarLinea, eliminarUnProducto,
 *   guardarCantidadLinea, editarPrecio, calcularTotal, toggleCargo,
 *   guardarCargosPendientes, cerrarFactura, cobrarFactura, datosTicket,
 *   imprimirPrefactura, imprimirPrefacturaItems, imprimirTicketPagado,
 *   abrirCobroItems, prepararSeleccionItems, refrescarItemsDesdeBD,
 *   cobrarItems, moverLinea.
 *
 * CUIDADO:
 *   - No volver a introducir `setState({ ...this.state, ... })` en
 *     cargarCategorias/cargarProductos: causó el bug de cuentas vacías por
 *     carrera entre promesas.
 *   - cargarFactura fija idFactura y líneas; respetar ese orden.
 *   - Las cantidades de una línea se guardan en serie con guardarCantidadLinea;
 *     dos PUT en paralelo pueden llegar desordenados y descuadrar la BD.
 *   - El cobro por ítems recarga la cuenta antes de cobrar y solo el POST
 *     decide si se cobró. Un fallo posterior de refresco/impresión no debe
 *     invitar a reintentar (la factura ya quedó pagada).
 *   - moverLinea solo ofrece cuentas abiertas de la mesa sin división;
 *     el backend vuelve a validar y fusiona únicamente producto + precio
 *     iguales. La cuenta origen se conserva aunque quede vacía.
 *   - Ver DOCUMENTACION_VINEDOPOS.md, secciones 7.7 y 8.
 * ============================================================================
 */
import React from "react";
import "../css/pedidos.css";
import 'bootstrap-icons/font/bootstrap-icons.css';
import axios from "axios";
import Cookies from 'universal-cookie';
import Swal from "sweetalert2";
import { Navbar, Nav, Container, Modal, Button, Form, Row, Col } from 'react-bootstrap'
import Table from 'react-bootstrap/Table'
import { ruta } from "../Ruta/ruta"
import { construirTicketHTML, datosDesdeDetalle, fechaHoraActual, imprimirTicket, obtenerConfigTicket, montoCargo } from "./ticket"
import logo from "../images/logo.png"
const baseUrl = ruta.baseUrl;
const cookies = new Cookies();

class pedidos extends React.Component {
  state = {
    productosBD: [],
    categoriasBD: [],
    factura: [],
    mesaActual: "",
    idFactura: 0,
    total: 0,
    cliente: "",
    clienteInput: "",
    cargosDisponibles: [],
    cargosAplicados: [],
    configTicket: null,
    showCartModal: false,
    categoriaSeleccionada: 0,
    showPayModal: false,
    pagos: [{ metodo_pago: 'EFECTIVO', monto: 0, referencia: '' }],
    vuelto: 0,
    metodosPago: [
      { id: 1, nombre: 'EFECTIVO' },
      { id: 2, nombre: 'TARJETA' },
      { id: 3, nombre: 'TRANSFERENCIA' },
      { id: 4, nombre: 'OTRO' }
    ],
    cuentas: [],
    cuentaActiva: 0,
    showCuentasModal: false,
    showItemsModal: false,
    itemsSeleccion: {},
    itemsBase: 0,
    itemsCargos: [],
    itemsTotal: 0,
    itemsVuelto: 0,
    pagosItems: [{ metodo_pago: 'EFECTIVO', monto: 0, referencia: '' }],
    division: null,
    cobrandoParte: false,
    mesasDisponibles: []
  }
  listaFacturaRef = React.createRef()
  scrollListaFactura = (direccion) => {
    const el = this.listaFacturaRef.current
    if (!el) return
    const paso = Math.max(120, Math.floor(el.clientHeight * 0.6))
    el.scrollBy({ top: direccion === "up" ? -paso : paso, behavior: "smooth" })
  }
  // Cola de guardado por línea: evita que dos PUT de cantidad lleguen
  // desordenados y dejen la BD con una cantidad menor a la de la pantalla.
  colaLinea = {}
  toggleCartModal = () => {
    this.setState({ showCartModal: !this.state.showCartModal })
  }
  // ---- División igualitaria (Tramo 3) ----
  parteIgualitaria = (total, parte, partes) => {
    const totalPartes = Math.max(1, Math.floor(Number(partes) || 1))
    const numeroParte = Math.min(Math.max(1, Math.floor(Number(parte) || 1)), totalPartes)
    const centavos = Math.round((Number(total) || 0) * 100)
    const base = Math.floor(centavos / totalPartes)
    const sobrante = centavos - base * totalPartes
    return (base + (numeroParte <= sobrante ? 1 : 0)) / 100
  }
  abrirModalDivision = (datos) => {
    const division = {
      partes: Number(datos.partes || 0),
      partesPagadas: Number(datos.partesPagadas !== undefined ? datos.partesPagadas : datos.pagadas || 0),
      pagado: Number(datos.pagado || 0),
      restante: Number(datos.restante || 0),
      restantes: Number(datos.restantes || 0),
      siguienteParte: Number(datos.siguienteParte || 1),
      montoParte: Number(datos.siguienteMonto !== undefined ? datos.siguienteMonto : datos.montoParte || 0),
      total: Number(datos.total || 0)
    }
    this.setState({
      showPayModal: true,
      showCartModal: false,
      division,
      total: division.total || this.state.total,
      pagos: [{ metodo_pago: 'EFECTIVO', monto: division.montoParte, referencia: '' }],
      vuelto: 0,
      cobrandoParte: false
    })
  }
  iniciarDivision = async () => {
    const facturaID = this.idFacturaActual()
    if (!facturaID) {
      Swal.fire("Cuenta vacía", "Agregue productos antes de dividir.", "info")
      return
    }
    let datos = null
    try {
      const res = await axios.get(baseUrl + "factura/partes/" + facturaID)
      datos = res.data || {}
    } catch (e) {
      Swal.fire("Error", "No se pudo consultar la cuenta. Intente de nuevo.", "error")
      return
    }
    if (Number(datos.partes) > 0) {
      this.abrirModalDivision(datos)
      return
    }
    const opciones = { 2: "2 partes", 3: "3 partes", 4: "4 partes" }
    const total = Number(datos.total || this.state.total || 0)
    const { value, isConfirmed } = await Swal.fire({
      title: "Dividir cuenta",
      html: "Total de la cuenta: <strong>₡ " + total + "</strong><br/>Elija en cuántas partes iguales se divide.",
      input: "select",
      inputOptions: opciones,
      inputValue: "2",
      showCancelButton: true,
      confirmButtonText: "Dividir",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#16a34a",
      cancelButtonColor: "#FF6961"
    })
    if (!isConfirmed) return
    const partes = Math.max(2, Math.min(4, Math.floor(Number(value) || 2)))
    this.abrirModalDivision({
      partes,
      partesPagadas: 0,
      pagado: 0,
      restante: total,
      restantes: partes,
      siguienteParte: 1,
      siguienteMonto: this.parteIgualitaria(total, 1, partes),
      total
    })
  }
  cobrarParteDivision = async () => {
    const facturaID = this.idFacturaActual()
    const division = this.state.division
    if (!facturaID || !division) return
    if (this.state.cobrandoParte) return
    const montoParte = Number(division.montoParte || 0)
    let totalPagado = 0
    this.state.pagos.forEach(p => {
      totalPagado += parseFloat(p.monto || 0)
    })
    if (totalPagado < montoParte - 0.01) {
      Swal.fire(
        "Monto insuficiente",
        "La parte " + division.siguienteParte + " es de ₡ " + montoParte + ".",
        "warning"
      )
      return
    }
    const pagosLimpios = this.state.pagos.filter(p => parseFloat(p.monto || 0) > 0)
    this.setState({ cobrandoParte: true })
    try {
      const res = await axios.post(baseUrl + "factura/pagar-parte/", {
        FacturaID: facturaID,
        parte: division.siguienteParte,
        partes: division.partes,
        pagos: pagosLimpios,
        usuario_id: cookies.get('idUsuario') || null
      })
      const datos = res.data || {}
      await this.imprimirTicketParte(datos, datos.pagos || pagosLimpios)
      if (datos.cerrada) {
        this.setState({
          showPayModal: false,
          showCartModal: false,
          division: null,
          cobrandoParte: false,
          factura: [],
          idFactura: 0,
          cuentaActiva: 0,
          total: 0,
          cliente: ""
        })
        const { cuentas } = await this.cargarCuentas(0)
        const restantes = cuentas || []
        if (restantes.length > 0) {
          await this.cargarFactura(restantes[0].FacturaID)
          Swal.fire({
            toast: true,
            position: "top-end",
            icon: "success",
            title: "Cuenta dividida cobrada. Quedan " + restantes.length + " cuenta(s).",
            timer: 2200,
            showConfirmButton: false
          })
        } else {
          this.setearVacio()
          window.location.href = "/mesas"
        }
        return
      }
      const nuevaDivision = {
        partes: Number(datos.partes || division.partes),
        partesPagadas: Number(datos.pagadas || 0),
        pagado: Number(datos.pagado || 0),
        restante: Number(datos.restante || 0),
        restantes: Number(datos.restantes || 0),
        siguienteParte: Number(datos.siguienteParte || 0),
        montoParte: Number(datos.siguienteMonto || 0),
        total: Number(datos.total || division.total)
      }
      this.setState({
        division: nuevaDivision,
        cobrandoParte: false,
        total: nuevaDivision.total,
        pagos: [{ metodo_pago: 'EFECTIVO', monto: nuevaDivision.montoParte, referencia: '' }],
        vuelto: 0
      })
      await this.cargarCuentas(facturaID)
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Parte " + datos.parte + " pagada. Sigue la parte " + nuevaDivision.siguienteParte + " de " + nuevaDivision.partes + ".",
        timer: 2600,
        showConfirmButton: false
      })
    } catch (e) {
      this.setState({ cobrandoParte: false })
      const mensaje = (e && e.response && e.response.data && e.response.data.error) || "No se pudo cobrar la parte."
      Swal.fire("No se cobró la parte", mensaje, "error")
    }
  }
  objetivoCobro = () =>
    this.state.division
      ? Number(this.state.division.montoParte || 0)
      : parseFloat(this.state.total || 0)
  abrirCobro = async () => {
    const facturaID = this.idFacturaActual()
    if (!facturaID) {
      Swal.fire("Cuenta vacía", "Agregue productos antes de cobrar.", "info")
      return
    }
    let total = parseFloat(this.state.total || 0)
    try {
      const res = await axios.get(baseUrl + "factura/partes/" + facturaID)
      const datos = res.data || {}
      if (datos.total !== undefined) total = Number(datos.total)
      if (Number(datos.partes) > 0) {
        this.abrirModalDivision(datos)
        return
      }
    } catch (e) {}
    this.setState({
      showPayModal: true,
      showCartModal: false,
      division: null,
      total,
      pagos: [{ metodo_pago: 'EFECTIVO', monto: total, referencia: '' }],
      vuelto: 0
    })
  }
  cerrarCobro = () => {
    this.setState({ showPayModal: false, division: null, cobrandoParte: false })
  }
  agregarPago = () => {
    let totalPagado = 0
    this.state.pagos.forEach(p => {
      totalPagado += parseFloat(p.monto || 0)
    })
    const totalFactura = this.objetivoCobro()
    if (totalPagado >= totalFactura - 0.01) {
      return
    }
    const restante = totalFactura - totalPagado
    this.setState({ pagos: [...this.state.pagos, { metodo_pago: this.state.metodosPago[1] ? this.state.metodosPago[1].nombre : 'TARJETA', monto: restante > 0 ? restante : 0, referencia: '' }] }, this.calcularVuelto)
  }
  quitarPago = (index) => {
    const pagos = [...this.state.pagos]
    pagos.splice(index, 1)
    this.setState({ pagos }, this.calcularVuelto)
  }
  cambiarPago = (index, campo, valor) => {
    const pagos = [...this.state.pagos]
    pagos[index][campo] = valor
    this.setState({ pagos }, this.calcularVuelto)
  }
  calcularVuelto = () => {
    let totalPagadoEfectivo = 0
    this.state.pagos.forEach(p => {
      const metodo = (p.metodo_pago || '').toString().toUpperCase()
      if (metodo === 'EFECTIVO') {
        totalPagadoEfectivo += parseFloat(p.monto || 0)
      }
    })
    const vuelto = Math.round((totalPagadoEfectivo - this.objetivoCobro()) * 100) / 100
    this.setState({ vuelto: vuelto > 0 ? vuelto : 0 })
  }
  setearVacio() {
    this.setState({
      productosBD: [],
      categoriasBD: [],
      factura: [],
      mesaActual: "",
      idFactura: 0,
      total: 0,
      cliente: "",
      cargosAplicados: this.cargosPorDefecto(this.state.cargosDisponibles),
      cuentas: [],
      cuentaActiva: 0,
      showCuentasModal: false,
      showItemsModal: false,
      itemsSeleccion: {},
      itemsBase: 0,
      itemsCargos: [],
      itemsTotal: 0,
      itemsVuelto: 0,
      pagosItems: [{ metodo_pago: 'EFECTIVO', monto: 0, referencia: '' }],
      division: null,
      cobrandoParte: false
    })
  }
  cargarCategorias = async () => {
    await axios.get(baseUrl + "categorias/")
      .then((res) => {
        const categorias = res.data || []
        this.setState({
          categoriasBD: categorias,
          categoriaSeleccionada: categorias.length > 0 ? categorias[0].idCategoria : 0
        }, () => {
          if (categorias.length > 0) {
            this.cargarProductos(categorias[0].idCategoria)
          }
        })
      })
  }
  cargarProductos = async (categoria) => {
    const categoriaElegida = { categoriaID: categoria }
    this.setState({ categoriaSeleccionada: categoria })
    axios.post(baseUrl + "productos/", categoriaElegida)
      .then((res) => {
        this.setState({
          productosBD: res.data
        })
      })
  }
  cerrarSesion = () => {
    this.setearVacio()
    cookies.remove('idUsuario', { path: "/" })
    cookies.remove('usuario', { path: "/" })
    window.location.href = "/login"
  }
  componentDidMount() {
    if (!cookies.get('idUsuario')) {
      window.location.href = "/login"
    } else {
      obtenerConfigTicket().then((configTicket) => this.setState({ configTicket }))
      this.setState({ mesaActual: cookies.get('MesaID').Nombre })
      this.iniciarCuentas()
      this.cargarCategorias()
      axios.get(baseUrl + "cargos/").then(res => {
        const cargosDisponibles = res.data || []
        this.setState((prev) => ({
          cargosDisponibles,
          cargosAplicados: prev.idFactura
            ? prev.cargosAplicados
            : this.cargosPorDefecto(cargosDisponibles)
        }))
      }).catch(() => {})
      axios.get(baseUrl + "metodos-pago/all").then(res => {
        const activos = (res.data || []).filter(m => m.activo === 1)
        if (activos.length > 0) {
          this.setState({ metodosPago: activos.map(m => ({ id: m.id, nombre: m.nombre })) })
        } else {
          axios.get(baseUrl + "metodos-pago/").then(res2 => {
            if (res2.data && res2.data.length > 0) {
              this.setState({ metodosPago: res2.data.map(m => ({ id: m.id, nombre: m.nombre })) })
            }
          }).catch(() => {})
        }
      }).catch(() => {
        axios.get(baseUrl + "metodos-pago/").then(res => {
          if (res.data && res.data.length > 0) {
            this.setState({ metodosPago: res.data.map(m => ({ id: m.id, nombre: m.nombre })) })
          }
        }).catch(() => {})
      })
    }
  }
  cargarFactura = async (IDFactura) => {
    var Fact = { FacturaID: IDFactura }
    var lista = []
    const lineasTemp = await axios.post(baseUrl + "factura/previus/", Fact)
    const lineas = lineasTemp.data
    for (let i = 0; i < lineas.length; i++) {
      var lineaFactura = {
        codigo: lineas[i].codigo,
        FacturaID: lineas[i].FacturaID,
        Cantidad: lineas[i].Cantidad,
        Subtotal: lineas[i].Subtotal,
        Precio: lineas[i].Precio,
        Nombre: lineas[i].Nombre,
        LineaFacturaID: lineas[i].LineaFacturaID
      }
      lista.push(lineaFactura)
    }
    let cargosAplicados = []
    try {
      const cargosRes = await axios.get(baseUrl + "factura/cargos/" + IDFactura)
      cargosAplicados = cargosRes.data || []
    } catch (e) {
      cargosAplicados = []
    }
    this.setState({
      idFactura: IDFactura,
      cuentaActiva: IDFactura,
      factura: lista,
      cargosAplicados,
      division: null,
      total: this.calcularTotal(lista, cargosAplicados)
    })
    try {
      const clienteRes = await axios.get(baseUrl + "factura/cliente/" + IDFactura)
      const cliente = (clienteRes.data && clienteRes.data.Cliente) || ""
      this.setState({ cliente })
      return { lineas: lista, cargos: cargosAplicados, cliente }
    } catch (e) {
      this.setState({ cliente: "" })
      return { lineas: lista, cargos: cargosAplicados, cliente: "" }
    }
  }

  // ---- Cuentas de la mesa (Tramo 1) ----
  sincronizarTotalCuentas = (cuentas, cuentaActiva, total) =>
    (cuentas || []).map((cuenta) =>
      Number(cuenta.FacturaID) === Number(cuentaActiva)
        ? { ...cuenta, Total: total }
        : cuenta
    )

  cargarCuentas = async (preferida) => {
    const mesa = cookies.get('MesaID')
    if (!mesa || !mesa.MesaID) return { cuentas: [], activa: null }
    try {
      const res = await axios.get(baseUrl + "factura/cuentas/" + mesa.MesaID)
      const cuentas = res.data || []
      const idBuscado = preferida || this.state.cuentaActiva || mesa.FacturaID || 0
      const activa = cuentas.find(
        (cuenta) => Number(cuenta.FacturaID) === Number(idBuscado)
      ) || null
      this.setState({ cuentas })
      return { cuentas, activa }
    } catch (e) {
      return { cuentas: [], activa: null }
    }
  }

  iniciarCuentas = async () => {
    const { cuentas, activa } = await this.cargarCuentas()
    if (activa) {
      await this.cargarFactura(activa.FacturaID)
    } else {
      this.setState({ cuentaActiva: 0 })
    }
    return cuentas
  }

  cuentaTieneLineas = (cuenta) =>
    Number(cuenta.FacturaID) === Number(this.state.cuentaActiva)
      ? (this.state.factura || []).length > 0
      : Number(cuenta.Lineas || 0) > 0

  nombreCuentaDisponible = (nombre, exceptoID) => {
    const buscado = (nombre || "").trim().toLowerCase()
    return !(this.state.cuentas || []).some(
      (cuenta) =>
        Number(cuenta.FacturaID) !== Number(exceptoID) &&
        String(cuenta.Cliente || "").trim().toLowerCase() === buscado
    )
  }

  pedirNombreCuenta = async (titulo, valorInicial, exceptoID) => {
    const { value, isConfirmed } = await Swal.fire({
      title: titulo,
      input: "text",
      inputLabel: "Nombre de la cuenta",
      inputPlaceholder: "Ej. Ana",
      inputValue: valorInicial || "",
      showCancelButton: true,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#16a34a",
      cancelButtonColor: "#FF6961",
      inputValidator: (valor) => {
        const nombre = (valor || "").trim()
        if (nombre === "") return "Escriba un nombre para la cuenta"
        if (nombre.length > 40) return "Máximo 40 caracteres"
        if (!this.nombreCuentaDisponible(nombre, exceptoID)) {
          return "Ya existe una cuenta con ese nombre en esta mesa"
        }
        return null
      }
    })
    if (!isConfirmed) return null
    return (value || "").trim()
  }

  seleccionarCuenta = async (cuenta) => {
    if (!cuenta) return
    if (Number(cuenta.FacturaID) === Number(this.state.cuentaActiva)) {
      this.setState({ showCuentasModal: false })
      return
    }
    await this.cargarFactura(cuenta.FacturaID)
    this.setState({ showCuentasModal: false })
  }

  crearCuenta = async () => {
    const nombre = await this.pedirNombreCuenta("Nueva cuenta", "", 0)
    if (!nombre) return
    const mesa = cookies.get('MesaID')
    if (!mesa || !mesa.MesaID) return
    try {
      const res = await axios.post(baseUrl + "factura/add/", {
        MesaID: mesa.MesaID,
        NombreMesa: mesa.Nombre,
        Cliente: nombre
      })
      const idFactura = res.data[0].ID
      // Cada cuenta nace con los cargos predeterminados (ej. SERVICIO 10 %)
      const cargosNuevos = this.cargosPorDefecto(this.state.cargosDisponibles)
      await this.guardarCargosPendientes(idFactura, cargosNuevos)
      const { cuentas } = await this.cargarCuentas(idFactura)
      const existe = (cuentas || []).some(
        (cuenta) => Number(cuenta.FacturaID) === Number(idFactura)
      )
      if (existe) {
        await this.cargarFactura(idFactura)
      }
      this.setState({ showCuentasModal: false })
    } catch (e) {
      Swal.fire("Error", "No se pudo crear la cuenta.", "error")
    }
  }

  renombrarCuenta = async (cuenta) => {
    const objetivo = cuenta || (this.state.cuentas || []).find(
      (item) => Number(item.FacturaID) === Number(this.state.cuentaActiva)
    )
    if (!objetivo) return
    const nombre = await this.pedirNombreCuenta(
      "Renombrar cuenta",
      objetivo.Cliente || "",
      objetivo.FacturaID
    )
    if (!nombre) return
    await this.guardarCliente(objetivo.FacturaID, nombre)
    this.setState((prev) => ({
      cliente:
        Number(prev.cuentaActiva) === Number(objetivo.FacturaID)
          ? nombre
          : prev.cliente,
      cuentas: (prev.cuentas || []).map((item) =>
        Number(item.FacturaID) === Number(objetivo.FacturaID)
          ? { ...item, Cliente: nombre }
          : item
      )
    }))
  }

  eliminarCuenta = async (cuenta) => {
    if (!cuenta) return
    if (this.cuentaTieneLineas(cuenta)) {
      Swal.fire(
        "Cuenta con productos",
        "Pase o elimine los productos antes de borrar la cuenta.",
        "warning"
      )
      return
    }
    const confirmacion = await Swal.fire({
      title: "¿Eliminar la cuenta " + (cuenta.Cliente || "General") + "?",
      text: "La cuenta está vacía; no se perderán productos.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280"
    })
    if (!confirmacion.isConfirmed) return
    const eraActiva = Number(cuenta.FacturaID) === Number(this.state.cuentaActiva)
    try {
      await axios.post(baseUrl + "factura/eliminar/vacia", { FacturaID: cuenta.FacturaID })
      const { cuentas } = await this.cargarCuentas()
      if (eraActiva) {
        const siguiente = (cuentas || [])[0]
        if (siguiente) {
          await this.cargarFactura(siguiente.FacturaID)
        } else {
          this.setState({
            factura: [],
            total: 0,
            idFactura: 0,
            cuentaActiva: 0,
            cliente: "",
            cargosAplicados: this.cargosPorDefecto(this.state.cargosDisponibles)
          })
        }
      }
      this.setState({ showCuentasModal: false })
    } catch (e) {
      Swal.fire("Error", "No se pudo eliminar la cuenta.", "error")
    }
  }

  transferirCuenta = async (cuenta) => {
    if (!cuenta) return
    if (Number(cuenta.PartesPagadas || 0) > 0) {
      Swal.fire("Cuenta en división", "Termine de cobrar las partes pendientes antes de transferir.", "warning")
      return
    }
    try {
      const res = await axios.get(baseUrl + "mesas/")
      const mesas = (res.data || []).filter((m) => Number(m.MesaID) !== Number(cookies.get('MesaID').MesaID))
      if (mesas.length === 0) {
        Swal.fire("Sin mesas destino", "No hay otras mesas disponibles.", "info")
        return
      }
      const opciones = {}
      mesas.forEach((m) => { opciones[m.MesaID] = m.Nombre })
      const { value, isConfirmed } = await Swal.fire({
        title: "Transferir cuenta",
        text: "Cuenta: " + (cuenta.Cliente || "General"),
        input: "select",
        inputOptions: opciones,
        inputPlaceholder: "Seleccione mesa destino",
        showCancelButton: true,
        confirmButtonText: "Transferir",
        cancelButtonText: "Cancelar"
      })
      if (!isConfirmed || !value) return
      const destino = mesas.find((m) => Number(m.MesaID) === Number(value))
      if (!destino) return
      await axios.post(baseUrl + "factura/transferir", {
        FacturaID: cuenta.FacturaID,
        MesaID: destino.MesaID,
        NombreMesa: destino.Nombre
      })
      Swal.fire("Cuenta transferida", "La cuenta se movió a " + destino.Nombre, "success")
      this.setState({ showCuentasModal: false })
      this.setearVacio()
      window.location.href = "/mesas"
    } catch (e) {
      const mensaje = (e && e.response && e.response.data && e.response.data.error) || "No se pudo transferir la cuenta"
      Swal.fire("Error", mensaje, "error")
    }
  }

  agregarALista = async (producto) => {
    const mesaElegida = { MesaID: cookies.get('MesaID').MesaID, NombreMesa: cookies.get('MesaID').Nombre }
    var lista = this.state.factura
    if (lista.length === 0) {
      // Reutilizar la cuenta activa; solo crear una nueva si no hay ninguna
      let idFactura = this.idFacturaActual()
      if (!idFactura) {
        const idFac = await axios.post(baseUrl + "factura/add/", mesaElegida)
        idFactura = idFac.data[0].ID
      }
      const cargosGuardados = await this.guardarCargosPendientes(idFactura)
      var lineaFactura = {
        codigo: producto.codigo,
        FacturaID: idFactura,
        Cantidad: 1,
        Subtotal: producto.precio,
        Precio: producto.precio,
        Nombre: producto.nombre,
        LineaFacturaID: 0
      }
      const idLineFact = await axios.post(baseUrl + "factura/linea/", lineaFactura)
      lineaFactura.LineaFacturaID = idLineFact.data[0].ID
      lista.push(lineaFactura)
      if (this.state.cliente) {
        this.guardarCliente(idFactura, this.state.cliente)
      }
      const existeCuenta = (this.state.cuentas || []).some(
        (cuenta) => Number(cuenta.FacturaID) === Number(idFactura)
      )
      const cuentasActuales = existeCuenta
        ? this.state.cuentas
        : [
            ...(this.state.cuentas || []),
            {
              FacturaID: idFactura,
              Cliente: this.state.cliente || "",
              Base: 0,
              Cargos: 0,
              Total: 0,
              Lineas: 0
            }
          ]
      this.setState({
        idFactura,
        cuentaActiva: idFactura,
        cuentas: cuentasActuales,
        factura: lista,
        cargosAplicados: cargosGuardados
      }, () => this.actualizarTotal())
    } else {
      let i = -1
      for (let index = 0; index < lista.length; index++) {
        if (lista[index].codigo === producto.codigo) {
          i = index
        }
      }
      if (i !== -1) {
        lista[i].Cantidad = lista[i].Cantidad + 1
        lista[i].Subtotal = lista[i].Precio * lista[i].Cantidad
        this.setState({ factura: lista })
        this.actualizarTotal()
        await this.guardarCantidadLinea(lista[i])
      } else {
        lineaFactura = {
          codigo: producto.codigo,
          FacturaID: this.state.idFactura,
          Cantidad: 1,
          Subtotal: producto.precio,
          Precio: producto.precio,
          Nombre: producto.nombre,
          LineaFacturaID: 0
        }
        const idLineFact = await axios.post(baseUrl + "factura/linea/", lineaFactura)
        lineaFactura.LineaFacturaID = idLineFact.data[0].ID
        lista.push(lineaFactura)
        this.setState({ factura: lista })
        this.actualizarTotal()
      }
    }
  }
  eliminarLinea(linea) {
    var lista = this.state.factura
    for (let index = 0; index < lista.length; index++) {
      if (lista[index].LineaFacturaID === linea.LineaFacturaID) {
        const remo = lista.splice(index, 1)
        axios.post(baseUrl + "linea/delete/", remo[0])
        if (lista.length === 0) {
          const idFactura = this.state.idFactura
          const cuentaConNombre = (this.state.cliente || "").trim() !== ""
          // La cuenta general vacía se elimina; una cuenta con nombre se conserva
          if (idFactura && idFactura !== 0 && !cuentaConNombre) {
            axios.post(baseUrl + "factura/eliminar/vacia", { FacturaID: idFactura })
            this.setState((prev) => ({
              factura: [],
              total: 0,
              idFactura: 0,
              cuentaActiva: 0,
              cliente: "",
              cargosAplicados: this.cargosPorDefecto(prev.cargosDisponibles),
              cuentas: (prev.cuentas || []).filter(
                (cuenta) => Number(cuenta.FacturaID) !== Number(idFactura)
              )
            }))
            return
          }
          this.setState({ factura: [], total: 0 }, () => this.actualizarTotal())
          return
        }
        this.setState({ factura: lista })
        this.actualizarTotal()
        break
      }
    }
  }
  // Mueve una línea (o parte de su cantidad) a otra cuenta de la misma mesa.
  // Si la cuenta destino ya tiene el mismo producto al mismo precio, fusiona.
  moverLinea = async (lineaFactura) => {
    if (!lineaFactura || !lineaFactura.LineaFacturaID) return
    const mesa = cookies.get('MesaID')
    if (!mesa || !mesa.MesaID) return
    const cuentaActiva = Number(this.state.idFactura)
    if (!cuentaActiva) return
    let cuentas = []
    try {
      const res = await axios.get(baseUrl + "factura/cuentas/" + mesa.MesaID)
      cuentas = res.data || []
      this.setState({ cuentas })
    } catch (e) {
      Swal.fire("Error", "No se pudieron consultar las cuentas de la mesa.", "error")
      return
    }
    const activa = cuentas.find((cuenta) => Number(cuenta.FacturaID) === cuentaActiva)
    if (activa && Number(activa.PartesPagadas || 0) > 0) {
      Swal.fire(
        "Cuenta en división",
        "Termine de cobrar las partes pendientes antes de mover productos.",
        "warning"
      )
      return
    }
    const destinos = cuentas.filter(
      (cuenta) =>
        Number(cuenta.FacturaID) !== cuentaActiva &&
        Number(cuenta.PartesPagadas || 0) === 0
    )
    if (destinos.length === 0) {
      Swal.fire(
        "Sin cuenta destino",
        "Cree otra cuenta en esta mesa o termine la división de las cuentas existentes.",
        "info"
      )
      return
    }
    const escapar = (texto) =>
      String(texto == null ? "" : texto)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
    const cantidadMax = Math.max(1, Math.floor(Number(lineaFactura.Cantidad || 1)))
    const opciones = destinos
      .map(
        (cuenta) =>
          '<option value="' + cuenta.FacturaID + '">' +
          escapar(cuenta.Cliente || "General") +
          " — ₡ " + Number(cuenta.Total || 0) +
          "</option>"
      )
      .join("")
    const cantidadHtml = cantidadMax > 1
      ? '<label for="swal-mover-cantidad" style="display:block;font-size:0.9rem;color:#475569;margin-top:4px">Cantidad a mover</label>' +
        '<input id="swal-mover-cantidad" type="number" min="1" max="' + cantidadMax + '" value="' + cantidadMax + '" class="swal2-input" style="width:100%;margin:6px 0 0 0" />'
      : '<input id="swal-mover-cantidad" type="hidden" value="1" />'
    const { value, isConfirmed } = await Swal.fire({
      title: "Mover producto",
      html:
        '<div style="text-align:left">' +
        '<div style="background:#f1f5f9;border-radius:10px;padding:10px 12px;margin-bottom:14px">' +
        '<div style="font-size:0.75rem;letter-spacing:0.05em;color:#64748b">PRODUCTO</div>' +
        '<strong style="font-size:1.05rem">' + escapar(lineaFactura.Nombre) + "</strong>" +
        '<div style="font-size:0.9rem;color:#475569">Cantidad en esta cuenta: <strong>' + cantidadMax + "</strong></div>" +
        "</div>" +
        '<label for="swal-mover-destino" style="display:block;font-size:0.9rem;color:#475569">Cuenta destino</label>' +
        '<select id="swal-mover-destino" class="swal2-select" style="width:100%;margin:6px 0 0 0">' + opciones + "</select>" +
        cantidadHtml +
        '<p style="font-size:0.82rem;color:#64748b;margin-top:14px;margin-bottom:0">' +
        "Si la cuenta destino ya tiene este producto al mismo precio, las cantidades se suman. El precio editado de la línea se conserva." +
        "</p></div>",
      showCancelButton: true,
      confirmButtonText: "Mover",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#0ea5e9",
      cancelButtonColor: "#6b7280",
      focusConfirm: false,
      didOpen: () => {
        const selector = document.getElementById("swal-mover-destino")
        if (selector) selector.focus()
      },
      preConfirm: () => {
        const selector = document.getElementById("swal-mover-destino")
        const entrada = document.getElementById("swal-mover-cantidad")
        const destino = Number(selector ? selector.value : 0)
        const cantidad = Math.floor(Number(entrada ? entrada.value : 1))
        if (!destino) return "Seleccione la cuenta destino"
        if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > cantidadMax) {
          return "Indique una cantidad entre 1 y " + cantidadMax
        }
        return { destino, cantidad }
      }
    })
    if (!isConfirmed || !value) return
    const destinoInfo = destinos.find(
      (cuenta) => Number(cuenta.FacturaID) === Number(value.destino)
    )
    try {
      const res = await axios.post(baseUrl + "factura/mover-linea/", {
        LineaFacturaID: lineaFactura.LineaFacturaID,
        FacturaDestinoID: value.destino,
        Cantidad: value.cantidad
      })
      const datos = res.data || {}
      await this.cargarCuentas(cuentaActiva)
      await this.cargarFactura(cuentaActiva)
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title:
          (datos.fusionada ? "Producto fusionado en " : "Producto movido a ") +
          ((destinoInfo && destinoInfo.Cliente) || "General"),
        timer: 2400,
        showConfirmButton: false
      })
    } catch (e) {
      const mensaje =
        (e && e.response && e.response.data && e.response.data.error) ||
        "No se pudo mover el producto."
      Swal.fire("No se movió", mensaje, "error")
    }
  }

  // Guarda la cantidad de una línea en orden. Cada llamada conserva una copia
  // de los valores de ese momento; la siguiente espera a que termine la anterior.
  guardarCantidadLinea = (linea) => {
    if (!linea || !linea.LineaFacturaID) return Promise.resolve()
    const clave = String(linea.LineaFacturaID)
    const datos = {
      LineaFacturaID: linea.LineaFacturaID,
      Cantidad: Number(linea.Cantidad || 0),
      Precio: linea.Precio != null ? linea.Precio : null,
      Subtotal: Number(linea.Subtotal || 0)
    }
    const anterior = this.colaLinea[clave] || Promise.resolve()
    const tarea = anterior
      .catch(() => {})
      .then(() => axios.put(baseUrl + "factura/linea/delete/", datos))
    this.colaLinea[clave] = tarea
    return tarea
  }

  eliminarUnProducto(linea) {
    var lista = this.state.factura
    for (let index = 0; index < lista.length; index++) {
      if (linea.LineaFacturaID === lista[index].LineaFacturaID) {
        if (linea.Cantidad > 1) {
          lista[index].Cantidad = lista[index].Cantidad - 1
          lista[index].Subtotal = lista[index].Cantidad * lista[index].Precio
          this.setState({ factura: lista })
          this.actualizarTotal()
          this.guardarCantidadLinea(lista[index])
        } else {
          this.eliminarLinea(linea)
        }
        break
      }
    }
  }

  editarPrecio = async (lineaFactura) => {
    const cantidad = Number(lineaFactura.Cantidad || 1)
    const { value } = await Swal.fire({
      title: "Cambiar precio",
      html:
        "<div style='font-size:1.05rem;font-weight:600'>" + lineaFactura.Nombre + "</div>" +
        "<div style='color:#6b7280;margin-top:6px'>Precio actual: ₡ " + lineaFactura.Precio +
        " · Cantidad: " + cantidad + "</div>" +
        "<div style='color:#6b7280;margin-top:4px;font-size:.9rem'>Solo se aplica a esta cuenta</div>",
      input: "number",
      inputLabel: "Nuevo precio unitario",
      inputValue: lineaFactura.Precio,
      inputAttributes: { min: 0, step: "any", inputmode: "decimal" },
      showCancelButton: true,
      confirmButtonText: "Aplicar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#16a34a",
      cancelButtonColor: "#FF6961",
      inputValidator: (valor) => {
        if (valor === "" || valor === null) return "Ingrese un precio"
        const numero = Number(valor)
        if (isNaN(numero) || numero < 0) return "El precio debe ser 0 o mayor"
        return null
      }
    })
    if (value === undefined || value === null || value === "") return
    const precio = Math.round(Number(value) * 100) / 100
    if (precio === Number(lineaFactura.Precio)) return
    const lista = this.state.factura.map((linea) =>
      linea.LineaFacturaID === lineaFactura.LineaFacturaID
        ? { ...linea, Precio: precio, Subtotal: precio * Number(linea.Cantidad || 1) }
        : linea
    )
    const actualizada = lista.find((linea) => linea.LineaFacturaID === lineaFactura.LineaFacturaID)
    if (!actualizada) return
    try {
      await this.guardarCantidadLinea(actualizada)
      this.setState({ factura: lista }, () => this.actualizarTotal())
    } catch (error) {
      Swal.fire("Error", "No se pudo guardar el nuevo precio", "error")
    }
  }

  renderPrecio = (lineaFactura) => (
    <span>
      {lineaFactura.Precio}
      <button
        className="btn btn-link btn-sm p-0 ms-1"
        title="Cambiar precio"
        onClick={() => this.editarPrecio(lineaFactura)}
      >
        <i className="bi bi-pencil-square"></i>
      </button>
    </span>
  )

  calcularTotal = (lineas, cargos) => {
    const base = (lineas || []).reduce((acc, linea) => acc + Number(linea.Subtotal || 0), 0)
    const totalCargos = (cargos || []).reduce(
      (acc, cargo) => acc + montoCargo(base, cargo.porcentaje),
      0
    )
    return Math.round((base + totalCargos) * 100) / 100
  }

  cargarCargosFactura = async (idFactura) => {
    if (!idFactura) {
      const cargosAplicados = this.cargosPorDefecto(this.state.cargosDisponibles)
      this.setState({ cargosAplicados }, () => this.actualizarTotal())
      return cargosAplicados
    }
    try {
      const res = await axios.get(baseUrl + "factura/cargos/" + idFactura)
      const cargosAplicados = res.data || []
      this.setState({ cargosAplicados }, () => this.actualizarTotal())
      return cargosAplicados
    } catch (e) {
      this.setState({ cargosAplicados: [] }, () => this.actualizarTotal())
      return []
    }
  }

  cargosPorDefecto = (disponibles) =>
    (disponibles || [])
      .filter((cargo) => Number(cargo.predeterminado) === 1)
      .map((cargo) => ({
        idCargo: Number(cargo.idCargo),
        nombre: cargo.nombre,
        porcentaje: Number(cargo.porcentaje),
        idFacturaCargo: null
      }))

  cargoAplicado = (cargo) =>
    (this.state.cargosAplicados || []).find((aplicado) =>
      aplicado.idCargo !== null && aplicado.idCargo !== undefined
        ? Number(aplicado.idCargo) === Number(cargo.idCargo)
        : String(aplicado.nombre).toUpperCase() === String(cargo.nombre).toUpperCase()
    )

  guardarCargosPendientes = async (idFactura, cargos = this.state.cargosAplicados) => {
    const pendientes = (cargos || []).filter(
      (cargo) => !cargo.idFacturaCargo
    )
    for (const cargo of pendientes) {
      try {
        await axios.post(baseUrl + "factura/cargo/", {
          FacturaID: idFactura,
          idCargo: cargo.idCargo || null,
          nombre: cargo.nombre,
          porcentaje: cargo.porcentaje
        })
      } catch (e) {
        // si falla uno, se conserva el resto de cargos
      }
    }
    try {
      const res = await axios.get(baseUrl + "factura/cargos/" + idFactura)
      return res.data || []
    } catch (e) {
      return []
    }
  }

  idFacturaActual = () => {
    if (this.state.idFactura) return this.state.idFactura
    const primera = (this.state.factura || [])[0]
    return primera && primera.FacturaID ? primera.FacturaID : 0
  }

  toggleCargo = async (cargo) => {
    const aplicado = this.cargoAplicado(cargo)
    if (aplicado) {
      if (aplicado.idFacturaCargo) {
        try {
          await axios.post(baseUrl + "factura/cargo/delete", {
            idFacturaCargo: aplicado.idFacturaCargo
          })
        } catch (e) {
          Swal.fire("Error", "No se pudo quitar el cargo.", "error")
          return
        }
      }
      const cargosAplicados = (this.state.cargosAplicados || []).filter(
        (item) => item !== aplicado
      )
      this.setState({ cargosAplicados }, () => this.actualizarTotal())
      return
    }

    const idFactura = this.idFacturaActual()
    if (idFactura) {
      try {
        await axios.post(baseUrl + "factura/cargo/", {
          FacturaID: idFactura,
          idCargo: cargo.idCargo,
          nombre: cargo.nombre,
          porcentaje: cargo.porcentaje
        })
        await this.cargarCargosFactura(idFactura)
      } catch (e) {
        Swal.fire("Error", "No se pudo aplicar el cargo a la cuenta.", "error")
      }
      return
    }

    const nuevo = {
      idCargo: Number(cargo.idCargo),
      nombre: cargo.nombre,
      porcentaje: Number(cargo.porcentaje),
      idFacturaCargo: null
    }
    this.setState(
      { cargosAplicados: [...(this.state.cargosAplicados || []), nuevo] },
      () => this.actualizarTotal()
    )
  }

  renderCargos = () => {
    const disponibles = this.state.cargosDisponibles || []
    if (disponibles.length === 0) return null
    const base = (this.state.factura || []).reduce(
      (acc, linea) => acc + Number(linea.Subtotal || 0),
      0
    )
    return (
      <div className="cargos-cuenta">
        <div className="cargos-titulo">Cargos</div>
        {disponibles.map((cargo) => {
          const aplicado = this.cargoAplicado(cargo)
          const porcentaje = aplicado ? Number(aplicado.porcentaje) : Number(cargo.porcentaje)
          return (
            <label className={"cargo-check" + (aplicado ? " activo" : "")} key={cargo.idCargo}>
              <input
                type="checkbox"
                checked={Boolean(aplicado)}
                onChange={() => this.toggleCargo(cargo)}
              />
              <span className="cargo-nombre">{cargo.nombre} {porcentaje}%</span>
              <span className="cargo-monto">
                {aplicado && base > 0 ? "₡ " + montoCargo(base, aplicado.porcentaje) : ""}
              </span>
            </label>
          )
        })}
      </div>
    )
  }

  actualizarTotal() {
    this.setState((prev) => {
      const total = this.calcularTotal(prev.factura, prev.cargosAplicados)
      return {
        total,
        cuentas: this.sincronizarTotalCuentas(
          prev.cuentas,
          prev.cuentaActiva || prev.idFactura,
          total
        )
      }
    })
  }
  cerrarFactura = async (ticket) => {
    const idFactura = this.idFacturaActual()
    if (!idFactura) {
      Swal.fire("Cuenta vacía", "Agregue productos antes de cobrar.", "info")
      return
    }
    var fac = {
      FacturaID: idFactura,
      Total: this.state.total
    }
    await axios.put(baseUrl + "factura/total/", fac)
    if (ticket === "ticket") {
      this.abrirCobro()
      return
    }
    await axios.put(baseUrl + "factura/cerrar/", fac)
    this.setearVacio()
    window.location.href = "/mesas"
  }
  cobrarFactura = async () => {
    const facturaID = this.idFacturaActual()
    if (!facturaID) {
      Swal.fire("Cuenta vacía", "Agregue productos antes de cobrar.", "info")
      return
    }
    let totalPagado = 0
    this.state.pagos.forEach(p => {
      totalPagado += parseFloat(p.monto || 0)
    })
    const totalFactura = parseFloat(this.state.total || 0)
    if (totalPagado < totalFactura - 0.01) {
      alert("El monto pagado es menor al total a pagar")
      return
    }
    const pagosLimpios = this.state.pagos.filter(p => parseFloat(p.monto || 0) > 0)
    let vueltoEfectivo = 0
    this.state.pagos.forEach(p => {
      const metodo = (p.metodo_pago || '').toString().toUpperCase()
      if (metodo === 'EFECTIVO') {
        vueltoEfectivo += parseFloat(p.monto || 0)
      }
    })
    const vuelto = vueltoEfectivo - totalFactura > 0 ? vueltoEfectivo - totalFactura : 0
    try {
      await axios.post(baseUrl + "factura/pagar/", {
        FacturaID: facturaID,
        pagos: pagosLimpios,
        usuario_id: cookies.get('idUsuario') || null,
        vuelto,
        Total: totalFactura
      })
      await this.imprimirTicketPagado(pagosLimpios, vuelto, totalFactura)
      const { cuentas } = await this.cargarCuentas(facturaID)
      const restantes = cuentas || []
      if (restantes.length > 0) {
        // La mesa sigue ocupada: abrir la siguiente cuenta sin salir de la mesa
        this.setState({
          showPayModal: false,
          showCartModal: false,
          factura: [],
          idFactura: 0,
          cuentaActiva: 0,
          total: 0,
          cliente: ""
        })
        const siguiente = restantes[0]
        await this.cargarFactura(siguiente.FacturaID)
        Swal.fire({
          toast: true,
          position: "top-end",
          icon: "success",
          title: "Cuenta pagada. Quedan " + restantes.length + " cuenta(s).",
          timer: 1800,
          showConfirmButton: false
        })
      } else {
        this.setearVacio()
        window.location.href = "/mesas"
      }
    } catch (e) {
      alert("Error al cobrar la factura")
    }
  }
  // ---- Cobro por ítems (Tramo 2) ----
  redondear2 = (valor) => Math.round((Number(valor) || 0) * 100) / 100

  resumenItemsSeleccionados = (
    seleccion = this.state.itemsSeleccion,
    lineas = this.state.factura,
    cargos = this.state.cargosAplicados
  ) => {
    const mapa = seleccion || {}
    let base = 0
    ;(lineas || []).forEach((linea) => {
      const disponible = Number(linea.Cantidad || 0)
      const cantidad = Math.max(0, Math.min(Number(mapa[linea.LineaFacturaID] || 0), disponible))
      if (cantidad > 0) {
        base += Number(linea.Precio || 0) * cantidad
      }
    })
    base = this.redondear2(base)
    const cargosConMonto = (cargos || []).map((cargo) => ({
      ...cargo,
      monto: this.redondear2(base * Number(cargo.porcentaje || 0) / 100)
    }))
    const totalCargos = cargosConMonto.reduce((acc, cargo) => acc + Number(cargo.monto || 0), 0)
    return {
      base,
      cargos: cargosConMonto,
      total: this.redondear2(base + totalCargos)
    }
  }

  recalcularItems = (
    seleccion = this.state.itemsSeleccion,
    pagos = this.state.pagosItems,
    lineas = this.state.factura,
    cargos = this.state.cargosAplicados
  ) => {
    const resumen = this.resumenItemsSeleccionados(seleccion, lineas, cargos)
    const totalAnterior = Number(this.state.itemsTotal || 0)
    const pagosActuales = pagos || []
    const pagosNuevos = pagosActuales.map((pago) => {
      const monto = Number(pago.monto || 0)
      const eraAutomatico = pagosActuales.length === 1 &&
        (monto === 0 || Math.abs(monto - totalAnterior) < 0.01)
      return eraAutomatico ? { ...pago, monto: resumen.total } : pago
    })
    const efectivo = pagosNuevos
      .filter((pago) => String(pago.metodo_pago || "").toUpperCase() === "EFECTIVO")
      .reduce((acc, pago) => acc + Number(pago.monto || 0), 0)
    this.setState({
      itemsSeleccion: seleccion,
      itemsBase: resumen.base,
      itemsCargos: resumen.cargos,
      itemsTotal: resumen.total,
      pagosItems: pagosNuevos,
      itemsVuelto: Math.max(0, this.redondear2(efectivo - resumen.total))
    })
    return { resumen, pagos: pagosNuevos }
  }

  // Ajusta la selección a lo que realmente existe hoy en la cuenta.
  prepararSeleccionItems = (lineas, seleccion) => {
    const disponibles = {}
    ;(lineas || []).forEach((linea) => {
      disponibles[linea.LineaFacturaID] = Number(linea.Cantidad || 0)
    })
    const ajustada = {}
    let huboAjustes = false
    Object.keys(seleccion || {}).forEach((idLinea) => {
      const pedida = Number(seleccion[idLinea] || 0)
      const disponible = disponibles[idLinea] || 0
      const cantidad = Math.min(pedida, disponible)
      if (cantidad !== pedida) huboAjustes = true
      if (cantidad > 0) ajustada[idLinea] = cantidad
    })
    return { seleccion: ajustada, huboAjustes }
  }

  // Recarga la cuenta y deja la selección dentro de las cantidades vigentes.
  refrescarItemsDesdeBD = async (facturaID) => {
    const cuenta = await this.cargarFactura(facturaID)
    const lineas = (cuenta && cuenta.lineas) || []
    if (lineas.length === 0) {
      this.setState({
        showItemsModal: false,
        itemsSeleccion: {},
        itemsBase: 0,
        itemsCargos: [],
        itemsTotal: 0,
        itemsVuelto: 0,
        pagosItems: [{ metodo_pago: 'EFECTIVO', monto: 0, referencia: '' }]
      })
      let siguiente = null
      try {
        const { cuentas } = await this.cargarCuentas()
        siguiente = (cuentas || [])[0] || null
      } catch (e) {}
      if (siguiente) {
        try {
          await this.cargarFactura(siguiente.FacturaID)
        } catch (e) {}
      } else {
        this.setearVacio()
      }
      return { vacia: true, ajustes: false, hayCuentas: Boolean(siguiente) }
    }
    const ajuste = this.prepararSeleccionItems(lineas, this.state.itemsSeleccion)
    this.recalcularItems(
      ajuste.seleccion,
      this.state.pagosItems,
      lineas,
      (cuenta && cuenta.cargos) || []
    )
    return { vacia: false, ajustes: ajuste.huboAjustes }
  }

  abrirCobroItems = async () => {
    const facturaID = this.idFacturaActual()
    if (!facturaID) {
      Swal.fire("Cuenta vacía", "Agregue productos antes de cobrar por ítems.", "info")
      return
    }
    let cuenta = null
    try {
      cuenta = await this.cargarFactura(facturaID)
    } catch (e) {
      Swal.fire("Error", "No se pudo actualizar la cuenta. Intente de nuevo.", "error")
      return
    }
    if (!cuenta || (cuenta.lineas || []).length === 0) {
      try {
        await this.cargarCuentas()
      } catch (e) {}
      Swal.fire("Cuenta actualizada", "Esta cuenta ya no tiene productos abiertos.", "info")
      return
    }
    let division = null
    try {
      const partesRes = await axios.get(baseUrl + "factura/partes/" + facturaID)
      division = partesRes.data || null
    } catch (e) {}
    if (division && Number(division.partes) > 0) {
      Swal.fire(
        "Cuenta en división",
        "Termine de cobrar las partes pendientes antes de cobrar por ítems.",
        "warning"
      )
      return
    }
    this.setState({
      showItemsModal: true,
      showPayModal: false,
      showCartModal: false,
      itemsSeleccion: {},
      itemsBase: 0,
      itemsCargos: [],
      itemsTotal: 0,
      itemsVuelto: 0,
      pagosItems: [{ metodo_pago: 'EFECTIVO', monto: 0, referencia: '' }]
    })
  }

  cerrarCobroItems = () => {
    this.setState({ showItemsModal: false })
  }

  seleccionarItem = (linea, marcado) => {
    const seleccion = { ...(this.state.itemsSeleccion || {}) }
    if (marcado) {
      seleccion[linea.LineaFacturaID] = Number(linea.Cantidad || 1)
    } else {
      delete seleccion[linea.LineaFacturaID]
    }
    this.recalcularItems(seleccion)
  }

  cambiarCantidadItem = (linea, valor) => {
    const disponible = Number(linea.Cantidad || 0)
    let cantidad = Math.floor(Number(valor))
    if (isNaN(cantidad) || cantidad < 0) cantidad = 0
    if (cantidad > disponible) cantidad = disponible
    const seleccion = { ...(this.state.itemsSeleccion || {}) }
    if (cantidad > 0) {
      seleccion[linea.LineaFacturaID] = cantidad
    } else {
      delete seleccion[linea.LineaFacturaID]
    }
    this.recalcularItems(seleccion)
  }

  seleccionarTodosItems = () => {
    const seleccion = {}
    ;(this.state.factura || []).forEach((linea) => {
      const cantidad = Number(linea.Cantidad || 0)
      if (cantidad > 0) seleccion[linea.LineaFacturaID] = cantidad
    })
    this.recalcularItems(seleccion)
  }

  limpiarItems = () => {
    this.recalcularItems({})
  }

  agregarPagoItems = () => {
    let totalPagado = 0
    ;(this.state.pagosItems || []).forEach((pago) => {
      totalPagado += parseFloat(pago.monto || 0)
    })
    const totalFactura = parseFloat(this.state.itemsTotal || 0)
    if (totalPagado >= totalFactura - 0.01) return
    const restante = totalFactura - totalPagado
    const metodo = this.state.metodosPago[1] ? this.state.metodosPago[1].nombre : 'TARJETA'
    this.setState({
      pagosItems: [
        ...(this.state.pagosItems || []),
        { metodo_pago: metodo, monto: restante > 0 ? restante : 0, referencia: '' }
      ]
    }, this.calcularVueltoItems)
  }

  quitarPagoItems = (index) => {
    const pagosItems = [...(this.state.pagosItems || [])]
    pagosItems.splice(index, 1)
    this.setState({ pagosItems }, this.calcularVueltoItems)
  }

  cambiarPagoItems = (index, campo, valor) => {
    const pagosItems = [...(this.state.pagosItems || [])]
    pagosItems[index][campo] = valor
    this.setState({ pagosItems }, this.calcularVueltoItems)
  }

  calcularVueltoItems = () => {
    let efectivo = 0
    ;(this.state.pagosItems || []).forEach((pago) => {
      if (String(pago.metodo_pago || "").toUpperCase() === "EFECTIVO") {
        efectivo += parseFloat(pago.monto || 0)
      }
    })
    const vuelto = efectivo - parseFloat(this.state.itemsTotal || 0)
    this.setState({ itemsVuelto: vuelto > 0 ? this.redondear2(vuelto) : 0 })
  }

  // Prefactura de solo los ítems marcados. No crea factura ni pago.
  imprimirPrefacturaItems = async () => {
    const facturaID = this.idFacturaActual()
    if (!facturaID) {
      Swal.fire("Cuenta vacía", "Agregue productos antes de imprimir.", "info")
      return
    }
    let lineas = this.state.factura || []
    let cargos = this.state.cargosAplicados || []
    let seleccion = this.state.itemsSeleccion || {}
    try {
      const cuenta = await this.cargarFactura(facturaID)
      if (cuenta && (cuenta.lineas || []).length > 0) {
        lineas = cuenta.lineas
        cargos = cuenta.cargos || []
        const ajuste = this.prepararSeleccionItems(lineas, seleccion)
        seleccion = ajuste.seleccion
        this.recalcularItems(seleccion, this.state.pagosItems, lineas, cargos)
      }
    } catch (e) {
      // Si no se puede refrescar, se imprime con lo que se ve en pantalla
    }
    const lineasTicket = []
    ;(lineas || []).forEach((linea) => {
      const disponible = Number(linea.Cantidad || 0)
      const cantidad = Math.max(0, Math.min(Number(seleccion[linea.LineaFacturaID] || 0), disponible))
      if (cantidad > 0) {
        lineasTicket.push({
          Nombre: linea.Nombre,
          Cantidad: cantidad,
          Precio: Number(linea.Precio || 0),
          Subtotal: this.redondear2(Number(linea.Precio || 0) * cantidad)
        })
      }
    })
    if (lineasTicket.length === 0) {
      Swal.fire("Sin selección", "Marque al menos un producto para la prefactura.", "info")
      return
    }
    const resumen = this.resumenItemsSeleccionados(seleccion, lineas, cargos)
    const { fecha, hora } = fechaHoraActual()
    const datos = {
      numero: facturaID,
      fecha,
      hora,
      mesa: this.state.mesaActual,
      cliente: this.state.cliente,
      cajero: cookies.get("usuario") || "",
      lineas: lineasTicket,
      cargos: resumen.cargos,
      total: resumen.total,
      pagos: [],
      vuelto: 0,
      nota: "Solo ítems seleccionados",
      modo: "prefactura"
    }
    const html = construirTicketHTML(datos, this.state.configTicket, "prefactura")
    await imprimirTicket(html)
  }

  cobrarItems = async () => {
    const facturaID = this.idFacturaActual()
    if (!facturaID) {
      Swal.fire("Cuenta vacía", "Agregue productos antes de cobrar.", "info")
      return
    }
    if (!this.state.itemsSeleccion || Object.keys(this.state.itemsSeleccion).length === 0) {
      Swal.fire("Sin selección", "Marque al menos un producto para cobrar.", "info")
      return
    }

    // Verificar contra la BD justo antes de cobrar: evita cobrar cantidades,
    // precios o cargos que ya cambiaron en la cuenta.
    let cuenta = null
    try {
      cuenta = await this.cargarFactura(facturaID)
    } catch (e) {
      Swal.fire("Error", "No se pudo verificar la cuenta antes de cobrar. Intente de nuevo.", "error")
      return
    }
    const lineas = (cuenta && cuenta.lineas) || []
    if (lineas.length === 0) {
      this.setState({
        showItemsModal: false,
        showPayModal: false,
        showCartModal: false,
        itemsSeleccion: {},
        itemsBase: 0,
        itemsCargos: [],
        itemsTotal: 0,
        itemsVuelto: 0,
        pagosItems: [{ metodo_pago: 'EFECTIVO', monto: 0, referencia: '' }]
      })
      try {
        await this.cargarCuentas()
      } catch (e) {}
      Swal.fire("Cuenta actualizada", "Esta cuenta ya no tiene productos abiertos.", "info")
      return
    }

    const ajuste = this.prepararSeleccionItems(lineas, this.state.itemsSeleccion)
    const { resumen, pagos: pagosAjustados } = this.recalcularItems(
      ajuste.seleccion,
      this.state.pagosItems,
      lineas,
      (cuenta && cuenta.cargos) || []
    )
    if (Object.keys(ajuste.seleccion).length === 0) {
      Swal.fire("Sin selección", "Los ítems seleccionados ya no están disponibles en la cuenta.", "warning")
      return
    }
    if (ajuste.huboAjustes) {
      Swal.fire(
        "Cuenta actualizada",
        "Se ajustó la selección a las cantidades disponibles. Revise y vuelva a intentar.",
        "warning"
      )
      return
    }

    const items = Object.keys(ajuste.seleccion).map((idLinea) => ({
      LineaFacturaID: Number(idLinea),
      Cantidad: Number(ajuste.seleccion[idLinea] || 0)
    }))
    const totalSeleccion = resumen.total
    let totalPagado = 0
    ;(pagosAjustados || []).forEach((pago) => {
      totalPagado += parseFloat(pago.monto || 0)
    })
    if (totalPagado < totalSeleccion - 0.01) {
      Swal.fire(
        "Pago incompleto",
        "El monto pagado (₡ " + this.redondear2(totalPagado) +
          ") es menor al total de los ítems seleccionados (₡ " + totalSeleccion + ").",
        "warning"
      )
      return
    }
    const pagosLimpios = (pagosAjustados || [])
      .filter((pago) => parseFloat(pago.monto || 0) > 0)
      .map((pago) => ({
        metodo_pago: pago.metodo_pago,
        monto: parseFloat(pago.monto || 0),
        referencia: pago.referencia || null
      }))

    // Solo el POST decide si el cobro se hizo. Si falla, no se toca la cuenta.
    let data = null
    try {
      const res = await axios.post(baseUrl + "factura/cobrar-items/", {
        FacturaID: facturaID,
        items,
        pagos: pagosLimpios,
        usuario_id: cookies.get('idUsuario') || null,
        Total: totalSeleccion
      })
      data = res.data || {}
    } catch (error) {
      const status = error && error.response ? error.response.status : 0
      const mensaje = error && error.response && error.response.data && error.response.data.error
        ? error.response.data.error
        : "No se pudo cobrar la selección. Intente de nuevo."
      if (status === 400) {
        // Datos viejos: recargar la cuenta y ajustar la selección antes de reintentar
        let estado = null
        try {
          estado = await this.refrescarItemsDesdeBD(facturaID)
        } catch (e) {}
        if (estado && estado.vacia) {
          await Swal.fire(
            "Cuenta actualizada",
            estado.hayCuentas
              ? "La cuenta ya no está abierta. Se abrió la siguiente cuenta de la mesa."
              : "La cuenta ya no está abierta. La mesa quedó libre.",
            "warning"
          )
          if (!estado.hayCuentas) {
            window.location.href = "/mesas"
          }
        } else {
          Swal.fire(
            "Cuenta actualizada",
            mensaje + " Se actualizó la cuenta; revise la selección e intente de nuevo.",
            "warning"
          )
        }
      } else {
        Swal.fire("Error", mensaje, "error")
      }
      return
    }

    // Cobro confirmado. Desde aquí un fallo de refresco o impresión NO debe
    // invitar a reintentar el cobro: la factura ya quedó pagada.
    if (data.detalle) {
      try {
        const html = construirTicketHTML(
          datosDesdeDetalle(data.detalle, "factura"),
          this.state.configTicket,
          "factura"
        )
        await imprimirTicket(html)
      } catch (e) {
        Swal.fire(
          "Cobro registrado",
          "La factura se cobró, pero no se pudo imprimir el ticket. Puede reimprimirla desde Facturas.",
          "warning"
        )
      }
    }
    this.setState({
      showItemsModal: false,
      showPayModal: false,
      showCartModal: false,
      itemsSeleccion: {},
      itemsBase: 0,
      itemsCargos: [],
      itemsTotal: 0,
      itemsVuelto: 0,
      pagosItems: [{ metodo_pago: 'EFECTIVO', monto: 0, referencia: '' }]
    })
    try {
      const { cuentas } = await this.cargarCuentas()
      const restantes = cuentas || []
      const origenSigueAbierta = restantes.some(
        (cuenta) => Number(cuenta.FacturaID) === Number(facturaID)
      )
      if (origenSigueAbierta) {
        await this.cargarFactura(facturaID)
        Swal.fire({
          toast: true,
          position: "top-end",
          icon: "success",
          title: "Ítems cobrados. El resto sigue en la cuenta.",
          timer: 2000,
          showConfirmButton: false
        })
      } else if (restantes.length > 0) {
        await this.cargarFactura(restantes[0].FacturaID)
        Swal.fire({
          toast: true,
          position: "top-end",
          icon: "success",
          title: "Cuenta pagada. Quedan " + restantes.length + " cuenta(s).",
          timer: 1800,
          showConfirmButton: false
        })
      } else {
        this.setearVacio()
        window.location.href = "/mesas"
      }
    } catch (e) {
      // El cobro ya se registró; volver a Mesas evita dejar datos viejos en pantalla
      this.setearVacio()
      window.location.href = "/mesas"
    }
  }

  redirectNav(choice) {
    if (
      this.state.factura.length === 0 &&
      this.state.idFactura &&
      this.state.idFactura !== 0 &&
      !this.state.cliente
    ) {
      this.eliminarfactura()
    }
    this.setearVacio()
    if (choice === "Administracion") {
      window.location.href = "/administracion"
    } else if (choice === "Mesas") {
      window.location.href = "/mesas"
    }
  }
  eliminarfactura = async () => {
    if (!this.state.idFactura || this.state.idFactura === 0) return
    var fact = { FacturaID: this.state.idFactura }
    await axios.post(baseUrl + "factura/eliminar/vacia", fact)
  }
  datosTicket = (modo, extras) => {
    const { fecha, hora } = fechaHoraActual()
    const base = {
      numero: this.state.idFactura,
      fecha,
      hora,
      mesa: this.state.mesaActual,
      cliente: this.state.cliente,
      cajero: cookies.get("usuario") || "",
      lineas: (this.state.factura || []).map((linea) => ({
        Nombre: linea.Nombre,
        Cantidad: linea.Cantidad,
        Precio: linea.Precio,
        Subtotal: linea.Subtotal
      })),
      cargos: (this.state.cargosAplicados || []).map((cargo) => ({
        nombre: cargo.nombre,
        porcentaje: Number(cargo.porcentaje),
        monto: montoCargo(
          (this.state.factura || []).reduce((acc, linea) => acc + Number(linea.Subtotal || 0), 0),
          cargo.porcentaje
        )
      })),
      total: this.state.total,
      pagos: [],
      vuelto: 0,
      modo
    }
    return { ...base, ...(extras || {}) }
  }
  imprimirPrefactura = () => {
    if (!this.state.factura || this.state.factura.length === 0) {
      alert("No hay productos en la cuenta")
      return
    }
    const html = construirTicketHTML(this.datosTicket("prefactura"), this.state.configTicket, "prefactura")
    imprimirTicket(html)
  }
  imprimirTicketPagado = (pagos, vuelto, total) => {
    const html = construirTicketHTML(
      this.datosTicket("factura", { pagos, vuelto, total }),
      this.state.configTicket,
      "factura"
    )
    return imprimirTicket(html)
  }
  imprimirTicketParte = (datos, pagos) => {
    const monto = Number(datos.montoParte || 0)
    const html = construirTicketHTML(
      this.datosTicket("factura", {
        lineas: [{ Nombre: "Su parte", Cantidad: 1, Precio: monto, Subtotal: monto }],
        cargos: [],
        total: monto,
        pagos: pagos || [],
        vuelto: Number(datos.vueltoParte || 0),
        nota: "Parte " + datos.parte + " de " + datos.partes
      }),
      this.state.configTicket,
      "factura"
    )
    return imprimirTicket(html)
  }
  agregarNombreCliente = async () => {
    const cliente = (this.state.clienteInput || "").trim()
    if (
      cliente !== "" &&
      !this.nombreCuentaDisponible(cliente, this.state.cuentaActiva || this.state.idFactura)
    ) {
      Swal.fire("Nombre repetido", "Ya existe una cuenta con ese nombre en esta mesa.", "warning")
      return
    }
    this.setState((prev) => ({
      cliente,
      clienteInput: "",
      cuentas: (prev.cuentas || []).map((cuenta) =>
        Number(cuenta.FacturaID) === Number(prev.cuentaActiva)
          ? { ...cuenta, Cliente: cliente }
          : cuenta
      )
    }))
    if (this.state.idFactura) {
      await this.guardarCliente(this.state.idFactura, cliente)
    }
  }
  guardarCliente = async (facturaID, cliente) => {
    try {
      await axios.put(baseUrl + "factura/cliente/", { FacturaID: facturaID, Cliente: cliente })
    } catch (e) {}
  }

  transferirCuenta = async (cuenta) => {
    if (!cuenta) return
    if (Number(cuenta.PartesPagadas || 0) > 0) {
      Swal.fire("Cuenta en división", "Termine de cobrar las partes pendientes antes de transferir.", "warning")
      return
    }
    try {
      const mesaCookie = cookies.get('MesaID')
      const mesaActualID = mesaCookie && mesaCookie.MesaID ? mesaCookie.MesaID : mesaCookie
      const res = await axios.get(baseUrl + "mesas/")
      const mesas = (res.data || []).filter((m) => Number(m.MesaID) !== Number(mesaActualID))
      if (mesas.length === 0) {
        Swal.fire("Sin mesas destino", "No hay otras mesas disponibles.", "info")
        return
      }
      const opciones = {}
      mesas.forEach((m) => { opciones[m.MesaID] = m.Nombre })
      const { value, isConfirmed } = await Swal.fire({
        title: "Transferir cuenta",
        text: "Cuenta: " + (cuenta.Cliente || "General"),
        input: "select",
        inputOptions: opciones,
        inputPlaceholder: "Seleccione mesa destino",
        showCancelButton: true,
        confirmButtonText: "Transferir",
        cancelButtonText: "Cancelar"
      })
      if (!isConfirmed || !value) return
      const destino = mesas.find((m) => Number(m.MesaID) === Number(value))
      if (!destino) return
      await axios.post(baseUrl + "factura/transferir", {
        FacturaID: cuenta.FacturaID,
        MesaID: destino.MesaID,
        NombreMesa: destino.Nombre
      })
      Swal.fire("Cuenta transferida", "La cuenta se movió a " + destino.Nombre, "success")
      this.setearVacio()
      window.location.href = "/mesas"
    } catch (e) {
      const mensaje = (e && e.response && e.response.data && e.response.data.error) || "No se pudo transferir la cuenta"
      Swal.fire("Error", mensaje, "error")
    }
  }

  renderCuentas = () => {
    const cuentas = this.state.cuentas || []
    const activa = cuentas.find(
      (cuenta) => Number(cuenta.FacturaID) === Number(this.state.cuentaActiva)
    )
    return (
      <div className="cuentas-barra">
        <div className="cuentas-chips">
          <span className="cuentas-titulo">Cuentas</span>
          {cuentas.map((cuenta) => {
            const esActiva = Number(cuenta.FacturaID) === Number(this.state.cuentaActiva)
            const total = esActiva ? this.state.total : Number(cuenta.Total || 0)
            const dividida = Number(cuenta.Partes || 0) > 0
            const totalVisible = dividida ? Number(cuenta.Restante || 0) : total
            return (
              <button
                key={cuenta.FacturaID}
                type="button"
                className={"chip-cuenta" + (esActiva ? " activa" : "") + (dividida ? " dividida" : "")}
                onClick={() => this.seleccionarCuenta(cuenta)}
                title={"Cuenta #" + cuenta.FacturaID + (dividida ? " · División " + Number(cuenta.PartesPagadas || 0) + " de " + Number(cuenta.Partes) : "")}
              >
                <span className="chip-nombre">{cuenta.Cliente || "General"}</span>
                <span className="chip-total">₡ {Number(totalVisible || 0)}</span>
                {dividida && (
                  <span className="chip-division">
                    {Number(cuenta.PartesPagadas || 0)}/{Number(cuenta.Partes)}
                  </span>
                )}
              </button>
            )
          })}
          <button type="button" className="chip-cuenta chip-nueva" onClick={this.crearCuenta}>
            <i className="bi bi-plus-lg"></i> Cuenta
          </button>
          {cuentas.length > 3 && (
            <button
              type="button"
              className="chip-ver"
              onClick={() => this.setState({ showCuentasModal: true })}
            >
              Ver todas ({cuentas.length})
            </button>
          )}
        </div>
        {activa && (
          <div className="cuentas-acciones">
            <button
              type="button"
              className="chip-accion"
              onClick={() => this.renombrarCuenta(activa)}
              title="Renombrar cuenta"
            >
              <i className="bi bi-pencil"></i> Renombrar
            </button>
            <button
              type="button"
              className="chip-accion"
              onClick={() => this.transferirCuenta(activa)}
              title="Transferir cuenta a otra mesa"
              disabled={Number(activa.PartesPagadas || 0) > 0}
            >
              <i className="bi bi-arrow-left-right"></i> Transferir
            </button>
            {!this.cuentaTieneLineas(activa) && (
              <button
                type="button"
                className="chip-accion chip-peligro"
                onClick={() => this.eliminarCuenta(activa)}
                title="Eliminar cuenta vacía"
              >
                <i className="bi bi-trash"></i> Borrar
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  render() {
    const itemsSeleccion = this.state.itemsSeleccion || {}
    const itemsCargos = this.state.itemsCargos || []
    const itemsBase = Number(this.state.itemsBase || 0)
    const itemsTotal = Number(this.state.itemsTotal || 0)
    const hayItemsSeleccionados = Object.keys(itemsSeleccion)
      .some((idLinea) => Number(itemsSeleccion[idLinea] || 0) > 0)
    const totalPagosItems = (this.state.pagosItems || [])
      .reduce((acc, pago) => acc + parseFloat(pago.monto || 0), 0)
    const cuentaActivaInfo = (this.state.cuentas || []).find(
      (cuenta) => Number(cuenta.FacturaID) === Number(this.state.idFactura)
    )
    const enDivision = !!(
      cuentaActivaInfo && Number(cuentaActivaInfo.PartesPagadas || 0) > 0
    )
    return (
      <body className="App-body">
        <div>
          <Navbar collapseOnSelect expand="lg" bg="dark" variant="dark">
            <Container>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button id="btNavbar" onClick={() => { window.location.href = "/mesas" }} style={{ padding: "0.3rem 0.7rem" }}>
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
              <Navbar.Toggle aria-controls="responsive-navbar-nav" />
              <Navbar.Collapse id="responsive-navbar-nav">
                <Nav className="me-auto">
                  <Nav.Link >
                    <button id="btNavbar" onClick={() => this.redirectNav("Administracion")}>Administración</button>
                  </Nav.Link>
                  <Nav.Link >
                    <button id="btNavbar" onClick={() => this.redirectNav("Mesas")}>Mesas</button>
                  </Nav.Link>
                </Nav>
                <Nav>
                  <Nav.Link>
                    <button id="btNavbar" onClick={() => this.cerrarSesion()}>Cerrar sesión</button>
                  </Nav.Link>
                </Nav>
              </Navbar.Collapse>
            </Container>
          </Navbar>
        </div>
        <div className="PedidosLayout">
          <div className="Tabla">
            <div className="TablaFactura" style={{ overflowX: "auto" }}>
              <div className="factura-scroll-wrap">
                <div className="factura-scroll-body" ref={this.listaFacturaRef}>
                  {this.renderCuentas()}
                  <div className="cliente">
                    <input type="text" placeholder="Nombre de la cuenta (opcional)" value={this.state.clienteInput} onChange={(e) => this.setState({ clienteInput: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") this.agregarNombreCliente() }} /><button className="btn-success btn-sm" onClick={() => this.agregarNombreCliente()}>Aceptar</button>
                  </div>
                  <h3 className="nombreC">{this.state.cliente ? "Cuenta: " + this.state.cliente : "Cuenta general"}</h3>
                  <Table responsive className="table-sm" id="tbF">
                    <thead>
                      <tr>
                        <th>{this.state.mesaActual}</th>
                        <th>Cuenta</th>
                        <th>{this.state.cliente || "General"}</th>
                        <th>N° Fact</th>
                        <th>{this.state.idFactura}</th>
                      </tr>
                      <tr>
                        <td>Producto</td>
                        <td>Precio</td>
                        <td>Cantidad</td>
                        <td>Subtotal</td>
                        <td></td>
                      </tr>
                    </thead>
                    <tbody id="tbody">
                      {this.state.factura.map((lineaFactura, index) => (
                        <tr key={index}>
                          <td>{lineaFactura.Nombre}</td>
                          <td>{this.renderPrecio(lineaFactura)}</td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <button className="btn btn-danger btn-sm" onClick={() => this.eliminarUnProducto(lineaFactura)}>-</button>
                              <span>{lineaFactura.Cantidad}</span>
                              <button className="btn btn-success btn-sm" onClick={() => this.agregarALista(lineaFactura)}>+</button>
                            </div>
                          </td>
                          <td>{lineaFactura.Subtotal}</td>
                          <td>
                            <div className="acciones-linea">
                              <button
                                className="btn btn-info btn-sm btMoverLinea"
                                onClick={() => this.moverLinea(lineaFactura)}
                                disabled={enDivision}
                                title={enDivision ? "Termine la división para mover productos" : "Mover a otra cuenta"}
                              >
                                <i className="bi bi-arrow-left-right"></i>
                              </button>
                              <button className="btn btn-danger btn-sm" onClick={() => this.eliminarLinea(lineaFactura)}><i className="bi bi-trash"></i></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                <div className="factura-scroll-nav">
                  <button type="button" className="factura-scroll-btn" onClick={() => this.scrollListaFactura("up")} title="Subir">
                    <i className="bi bi-chevron-up"></i>
                  </button>
                  <button type="button" className="factura-scroll-btn" onClick={() => this.scrollListaFactura("down")} title="Bajar">
                    <i className="bi bi-chevron-down"></i>
                  </button>
                </div>
              </div>
              {this.renderCargos()}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
                <label id="lbTotal1">Total</label><label id="lbTotal2">₡ {this.state.total}</label>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "10px" }}>
                <button id="btFactura1" onClick={() => this.imprimirPrefactura()}>Prefactura</button>
                <button id="btFactura2" onClick={() => this.cerrarFactura("ticket")}>{enDivision ? "Cobrar / continuar" : "Cobrar"}</button>
                <button id="btFacturaDividir" onClick={this.iniciarDivision}>
                  <i className="bi bi-people"></i> {enDivision ? "Continuar división" : "Dividir"}
                </button>
                <button
                  id="btFacturaItems"
                  onClick={this.abrirCobroItems}
                  disabled={enDivision}
                  title={enDivision ? "Termine de cobrar las partes pendientes" : ""}
                >
                  <i className="bi bi-list-check"></i> Cobrar por ítems
                </button>
              </div>
            </div>
          </div>
          <div className="duo">
            <div className="Productos">
              <div className="TablaProductos">
                {this.state.productosBD.map((producto, index) => (
                  <button key={index} className="btProductoCard" onClick={() => this.agregarALista(producto)}>
                    <span className="btProductoNombre">{producto.nombre}</span>
                    <span className="btProductoPrecio">₡ {producto.precio}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="Categorias">
              <div className="TablaCategoria">
                {this.state.categoriasBD.map((categoria, index) => (
                  <button
                    key={index}
                    id="btCategoria"
                    className={this.state.categoriaSeleccionada === categoria.idCategoria ? "btCategoriaActive" : ""}
                    onClick={() => this.cargarProductos(categoria.idCategoria)}
                  >
                    {categoria.Descripcion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <button className="cart-fab" onClick={this.toggleCartModal}>
          <i className="bi bi-cart3"></i> <span>Ver pedido · ₡ {this.state.total} · {this.state.factura.reduce((acc, item) => acc + (item.Cantidad || 0), 0)} items</span>
        </button>
        <Modal show={this.state.showCartModal} onHide={this.toggleCartModal} size="lg" centered className="cart-modal">
          <Modal.Header closeButton>
            <Modal.Title>Pedido - {this.state.mesaActual}</Modal.Title>
          </Modal.Header>
          <Modal.Body style={{ maxHeight: "70vh", overflowY: "auto" }}>
            {this.renderCuentas()}
            <div className="cliente" style={{ marginLeft: 0 }}>
              <input type="text" placeholder="Nombre de la cuenta (opcional)" value={this.state.clienteInput} onChange={(e) => this.setState({ clienteInput: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") this.agregarNombreCliente() }} /><button className="btn-success btn-sm" onClick={() => this.agregarNombreCliente()}>Aceptar</button>
            </div>
            <h3 className="nombreC" style={{ marginLeft: 0 }}>{this.state.cliente ? "Cuenta: " + this.state.cliente : "Cuenta general"}</h3>
            <Table responsive className="table-sm" id="tbF">
              <thead>
                <tr>
                  <td>Producto</td>
                  <td>Precio</td>
                  <td>Cantidad</td>
                  <td>Subtotal</td>
                  <td></td>
                </tr>
              </thead>
              <tbody>
                {this.state.factura.map((lineaFactura, index) => (
                  <tr key={index}>
                    <td>{lineaFactura.Nombre}</td>
                    <td>{this.renderPrecio(lineaFactura)}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <button className="btn btn-danger btn-sm" onClick={() => this.eliminarUnProducto(lineaFactura)}>-</button>
                        <span>{lineaFactura.Cantidad}</span>
                        <button className="btn btn-success btn-sm" onClick={() => this.agregarALista(lineaFactura)}>+</button>
                      </div>
                    </td>
                    <td>{lineaFactura.Subtotal}</td>
                    <td>
                      <div className="acciones-linea">
                        <button
                          className="btn btn-info btn-sm btMoverLinea"
                          onClick={() => this.moverLinea(lineaFactura)}
                          disabled={enDivision}
                          title={enDivision ? "Termine la división para mover productos" : "Mover a otra cuenta"}
                        >
                          <i className="bi bi-arrow-left-right"></i>
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => this.eliminarLinea(lineaFactura)}><i className="bi bi-trash"></i></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {this.renderCargos()}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
              <strong>Total</strong>
              <strong>₡ {this.state.total}</strong>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={this.toggleCartModal}>Seguir agregando</Button>
            <Button variant="primary" onClick={() => this.imprimirPrefactura()}>Prefactura</Button>
            <Button variant="outline-primary" onClick={this.abrirCobroItems} disabled={enDivision}>
              Cobrar por ítems
            </Button>
            <Button variant="outline-success" onClick={this.iniciarDivision}>
              <i className="bi bi-people"></i> {enDivision ? "Continuar división" : "Dividir"}
            </Button>
            <Button variant="success" onClick={() => this.abrirCobro()}>Cobrar</Button>
          </Modal.Footer>
        </Modal>

        <Modal show={this.state.showPayModal} onHide={this.cerrarCobro} centered className="pay-modal">
          <Modal.Header closeButton>
            <Modal.Title><i className="bi bi-cash-stack"></i> Cobrar factura</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
              <div>
                <div style={{ color: "#6b7280" }}>Mesa</div>
                <strong>{this.state.mesaActual}</strong>
                <div style={{ color: "#6b7280", marginTop: "6px" }}>Cuenta</div>
                <strong>{this.state.cliente || "General"}</strong>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#6b7280" }}>
                  {this.state.division
                    ? "Parte " + this.state.division.siguienteParte + " de " + this.state.division.partes
                    : "Total a pagar"}
                </div>
                <strong style={{ fontSize: "1.4rem" }}>
                  ₡ {this.state.division ? this.state.division.montoParte : this.state.total}
                </strong>
              </div>
            </div>
            {this.state.division && (
              <div className="division-panel">
                <div className="division-cabecera">
                  <span><i className="bi bi-people"></i> División igualitaria</span>
                  <span>{this.state.division.partesPagadas} de {this.state.division.partes} pagadas</span>
                </div>
                <div className="division-chips">
                  {Array.from({ length: this.state.division.partes }, (_, indice) => indice + 1).map((numero) => (
                    <span
                      key={numero}
                      className={
                        "chip-parte" +
                        (numero <= this.state.division.partesPagadas
                          ? " pagada"
                          : numero === this.state.division.siguienteParte
                            ? " actual"
                            : "")
                      }
                    >
                      {numero}
                    </span>
                  ))}
                </div>
                <div className="division-resumen">
                  <div>
                    <span>Total cuenta</span>
                    <strong>₡ {this.state.division.total}</strong>
                  </div>
                  <div>
                    <span>Pagado</span>
                    <strong>₡ {this.state.division.pagado}</strong>
                  </div>
                  <div>
                    <span>Saldo restante</span>
                    <strong>₡ {this.state.division.restante}</strong>
                  </div>
                </div>
                <div className="division-ayuda">
                  Cada persona recibe un ticket con solo su parte y su pago.
                </div>
              </div>
            )}
            {this.state.pagos.map((pago, index) => (
              <Row key={index} className="align-items-center" style={{ marginBottom: "10px" }}>
                <Col xs={5}>
                  <Form.Select value={pago.metodo_pago} onChange={(e) => this.cambiarPago(index, 'metodo_pago', e.target.value)}>
                    {this.state.metodosPago.map((m, mi) => (
                      <option key={mi} value={m.nombre}>{m.nombre}</option>
                    ))}
                  </Form.Select>
                </Col>
                <Col xs={5}>
                  <Form.Control type="number" value={pago.monto} onChange={(e) => this.cambiarPago(index, 'monto', e.target.value)} onBlur={this.calcularVuelto} />
                </Col>
                <Col xs={2}>
                  {this.state.pagos.length > 1 && (
                    <Button variant="outline-danger" size="sm" onClick={() => this.quitarPago(index)}><i className="bi bi-x"></i></Button>
                  )}
                </Col>
              </Row>
            ))}
            {(() => {
              let totalPagado = 0
              this.state.pagos.forEach(p => { totalPagado += parseFloat(p.monto || 0) })
              if (totalPagado >= this.objetivoCobro() - 0.01) return null
              return <Button variant="link" onClick={this.agregarPago}><i className="bi bi-plus"></i> Agregar otro pago</Button>
            })()}
            <hr />
            <div className="pay-vuelto" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Vuelto (solo efectivo)</span>
              <strong>₡ {this.state.vuelto}</strong>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={this.cerrarCobro} disabled={this.state.cobrandoParte}>
              Cancelar
            </Button>
            {!this.state.division && (
              <>
                <Button variant="outline-primary" onClick={this.abrirCobroItems}>
                  <i className="bi bi-list-check"></i> Cobrar solo algunos ítems
                </Button>
                <Button variant="outline-success" onClick={this.iniciarDivision}>
                  <i className="bi bi-people"></i> Dividir en partes
                </Button>
              </>
            )}
            {this.state.division ? (
              <Button variant="success" onClick={this.cobrarParteDivision} disabled={this.state.cobrandoParte}>
                <i className="bi bi-check-lg"></i>{" "}
                {this.state.cobrandoParte
                  ? "Cobrando..."
                  : "Cobrar parte " + this.state.division.siguienteParte + " e imprimir"}
              </Button>
            ) : (
              <Button variant="success" onClick={this.cobrarFactura}>
                <i className="bi bi-check-lg"></i> Cobrar e imprimir
              </Button>
            )}
          </Modal.Footer>
        </Modal>

        <Modal
          show={this.state.showItemsModal}
          onHide={this.cerrarCobroItems}
          size="lg"
          centered
          className="items-modal"
        >
          <Modal.Header closeButton>
            <Modal.Title><i className="bi bi-list-check"></i> Cobrar por ítems</Modal.Title>
          </Modal.Header>
          <Modal.Body style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <div className="items-cabecera">
              <div>
                <div className="items-etiqueta">Mesa</div>
                <strong>{this.state.mesaActual}</strong>
              </div>
              <div>
                <div className="items-etiqueta">Cuenta</div>
                <strong>{this.state.cliente || "General"}</strong>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="items-etiqueta">Seleccionado</div>
                <strong>₡ {itemsTotal}</strong>
              </div>
            </div>
            <div className="items-acciones">
              <Button size="sm" variant="outline-secondary" onClick={this.seleccionarTodosItems}>
                Seleccionar todo
              </Button>
              <Button size="sm" variant="outline-secondary" onClick={this.limpiarItems}>
                Limpiar
              </Button>
              <span className="items-ayuda">La prefactura imprime solo lo marcado.</span>
            </div>
            <Table responsive className="table-sm items-tabla">
              <thead>
                <tr>
                  <th></th>
                  <th>Producto</th>
                  <th>Precio</th>
                  <th>Cant. cuenta</th>
                  <th>Cobrar</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {(this.state.factura || []).map((lineaFactura) => {
                  const cantidad = Number(itemsSeleccion[lineaFactura.LineaFacturaID] || 0)
                  const subtotal = this.redondear2(Number(lineaFactura.Precio || 0) * cantidad)
                  return (
                    <tr key={lineaFactura.LineaFacturaID} className={cantidad > 0 ? "item-fila-activa" : ""}>
                      <td>
                        <Form.Check
                          type="checkbox"
                          checked={cantidad > 0}
                          onChange={(e) => this.seleccionarItem(lineaFactura, e.target.checked)}
                        />
                      </td>
                      <td>{lineaFactura.Nombre}</td>
                      <td>₡ {lineaFactura.Precio}</td>
                      <td>{lineaFactura.Cantidad}</td>
                      <td>
                        <Form.Control
                          className="item-cantidad"
                          size="sm"
                          type="number"
                          min={0}
                          max={lineaFactura.Cantidad}
                          step={1}
                          value={cantidad}
                          onChange={(e) => this.cambiarCantidadItem(lineaFactura, e.target.value)}
                        />
                      </td>
                      <td>₡ {subtotal}</td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            <div className="items-resumen">
              <div>
                <span>Base seleccionada</span>
                <strong>₡ {itemsBase}</strong>
              </div>
              {itemsCargos.map((cargo, index) => (
                <div key={(cargo.idFacturaCargo || cargo.nombre) + "-" + index}>
                  <span>{cargo.nombre} {cargo.porcentaje}%</span>
                  <strong>₡ {cargo.monto}</strong>
                </div>
              ))}
              <div className="items-total">
                <span>Total a cobrar</span>
                <strong>₡ {itemsTotal}</strong>
              </div>
            </div>
            <hr />
            <div className="items-pago-titulo">Forma de pago</div>
            {(this.state.pagosItems || []).map((pago, index) => (
              <Row key={index} className="align-items-center" style={{ marginBottom: "10px" }}>
                <Col xs={5}>
                  <Form.Select
                    value={pago.metodo_pago}
                    onChange={(e) => this.cambiarPagoItems(index, 'metodo_pago', e.target.value)}
                  >
                    {this.state.metodosPago.map((metodo, indice) => (
                      <option key={indice} value={metodo.nombre}>{metodo.nombre}</option>
                    ))}
                  </Form.Select>
                </Col>
                <Col xs={5}>
                  <Form.Control
                    type="number"
                    value={pago.monto}
                    onChange={(e) => this.cambiarPagoItems(index, 'monto', e.target.value)}
                    onBlur={this.calcularVueltoItems}
                  />
                </Col>
                <Col xs={2}>
                  {this.state.pagosItems.length > 1 && (
                    <Button variant="outline-danger" size="sm" onClick={() => this.quitarPagoItems(index)}>
                      <i className="bi bi-x"></i>
                    </Button>
                  )}
                </Col>
              </Row>
            ))}
            {totalPagosItems < itemsTotal - 0.01 && (
              <Button variant="link" onClick={this.agregarPagoItems}>
                <i className="bi bi-plus"></i> Agregar otro pago
              </Button>
            )}
            <div className="items-vuelto">
              <span>Vuelto (solo efectivo)</span>
              <strong>₡ {this.state.itemsVuelto}</strong>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={this.cerrarCobroItems}>Cancelar</Button>
            <Button
              variant="outline-primary"
              onClick={this.imprimirPrefacturaItems}
              disabled={!hayItemsSeleccionados}
            >
              <i className="bi bi-printer"></i> Prefactura
            </Button>
            <Button
              variant="success"
              onClick={this.cobrarItems}
              disabled={!hayItemsSeleccionados}
            >
              <i className="bi bi-check-lg"></i> Cobrar selección e imprimir
            </Button>
          </Modal.Footer>
        </Modal>

        <Modal
          show={this.state.showCuentasModal}
          onHide={() => this.setState({ showCuentasModal: false })}
          size="lg"
          centered
          className="cuentas-modal"
        >
          <Modal.Header closeButton>
            <Modal.Title><i className="bi bi-people"></i> Cuentas de {this.state.mesaActual}</Modal.Title>
          </Modal.Header>
          <Modal.Body style={{ maxHeight: "65vh", overflowY: "auto" }}>
            <Table responsive className="table-sm cuentas-tabla">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Productos</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(this.state.cuentas || []).map((cuenta) => {
                  const esActiva = Number(cuenta.FacturaID) === Number(this.state.cuentaActiva)
                  const lineas = esActiva ? (this.state.factura || []).length : Number(cuenta.Lineas || 0)
                  const total = esActiva ? this.state.total : Number(cuenta.Total || 0)
                  return (
                    <tr key={cuenta.FacturaID} className={esActiva ? "cuenta-fila-activa" : ""}>
                      <td>
                        <strong>{cuenta.Cliente || "General"}</strong>
                        <div className="cuenta-numero">Factura #{cuenta.FacturaID}</div>
                        {Number(cuenta.Partes || 0) > 0 && (
                          <div className="cuenta-division">
                            División {Number(cuenta.PartesPagadas || 0)}/{Number(cuenta.Partes)} · Resta ₡ {Number(cuenta.Restante || 0)}
                          </div>
                        )}
                      </td>
                      <td>{lineas}</td>
                      <td>₡ {Number(total || 0)}</td>
                      <td className="cuentas-botones">
                        <Button
                          size="sm"
                          variant={esActiva ? "secondary" : "success"}
                          onClick={() => this.seleccionarCuenta(cuenta)}
                        >
                          {esActiva ? "En uso" : "Abrir"}
                        </Button>
                        <Button size="sm" variant="outline-secondary" onClick={() => this.renombrarCuenta(cuenta)}>
                          <i className="bi bi-pencil"></i>
                        </Button>
                        {lineas === 0 && (
                          <Button size="sm" variant="outline-danger" onClick={() => this.eliminarCuenta(cuenta)}>
                            <i className="bi bi-trash"></i>
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            {(this.state.cuentas || []).length === 0 && (
              <p className="text-muted mb-3">Esta mesa todavía no tiene cuentas. Agregue la primera.</p>
            )}
            <Button variant="success" onClick={this.crearCuenta}>
              <i className="bi bi-plus-lg"></i> Nueva cuenta
            </Button>
          </Modal.Body>
        </Modal>
      </body>
    );
  }
}

export default pedidos;
