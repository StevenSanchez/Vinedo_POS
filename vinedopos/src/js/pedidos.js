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
import { Navbar, Nav, Container, Modal, Button, Form } from 'react-bootstrap'
import Table from 'react-bootstrap/Table'
import { ruta } from "../Ruta/ruta"
import { construirTicketHTML, datosDesdeDetalle, fechaHoraActual, imprimirTicket, obtenerConfigTicket, montoCargo, guarnicionesTicket } from "./ticket"
import logo from "../images/logo.png"
const baseUrl = ruta.baseUrl;
const cookies = new Cookies();

const escapar = (texto) =>
  String(texto === null || texto === undefined ? "" : texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const lineasDeTexto = (texto) =>
  String(texto || "")
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea !== "");

// Un producto con opciones (guarniciones/términos) no se fusiona con otra
// línea igual, para no perder la selección de cada comensal.
const llevaModificadores = (linea) =>
  Array.isArray(linea && linea.Modificadores) && linea.Modificadores.length > 0;

// Vuelto correcto en pagos mixtos: el excedente solo puede devolverse en
// efectivo. Ej.: total 10.000; tarjeta 5.000 + efectivo 6.000 -> vuelto 1.000.
const vueltoDePagos = (pagos, total) => {
  let efectivo = 0;
  let pagado = 0;
  (pagos || []).forEach((pago) => {
    const monto = Number(pago && pago.monto) || 0;
    if (monto <= 0) return;
    pagado += monto;
    if (String(pago.metodo_pago || "").toUpperCase() === "EFECTIVO") {
      efectivo += monto;
    }
  });
  const excedente = Math.max(0, pagado - (Number(total) || 0));
  return Math.round(Math.min(excedente, efectivo) * 100) / 100;
};

const validarPagos = (pagos) => {
  for (const pago of pagos || []) {
    if (!pago || !pago.metodo_pago) {
      return "Seleccione el método de pago en todas las filas.";
    }
    const monto = Number(pago.monto);
    if (Number.isNaN(monto) || monto < 0) {
      return "Los montos de pago no pueden ser negativos.";
    }
  }
  return "";
};

class pedidos extends React.Component {
  state = {
    productosBD: [],
    productosTodos: [],
    busquedaProducto: "",
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
    configComanda: null,
    categoriasCocina: [],
    categoriasConOpciones: [],
    showCartModal: false,
    categoriaSeleccionada: 0,
    catPuedeIzq: false,
    catPuedeDer: false,
    nombreCuentaModal: false,
    nombreCuentaTitulo: "",
    nombreCuentaValor: "",
    nombreCuentaError: "",
    nombreCuentaExceptoID: 0,
    showModModal: false,
    modProducto: null,
    modLinea: null,
    modGrupos: [],
    modSeleccion: {},
    modNota: "",
    modGuardando: false,
    showPayModal: false,
    pagos: [{ metodo_pago: 'EFECTIVO', monto: 0, referencia: '' }],
    vuelto: 0,
    cobrando: false,
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
  categoriasRef = React.createRef()
  nombreCuentaInputRef = React.createRef()
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
      pagos: [{ metodo_pago: this.metodoInicial(), monto: division.montoParte, referencia: '' }],
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
    if ((this.state.metodosPago || []).length === 0) {
      Swal.fire(
        "Sin métodos de pago",
        "Active al menos un método de pago en Administración.",
        "warning"
      )
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
    const errorPagos = validarPagos(this.state.pagos)
    if (errorPagos) {
      Swal.fire("Pago inválido", errorPagos, "warning")
      return
    }
    const pagosLimpios = this.state.pagos
      .map((pago) => ({ ...pago, monto: this.redondear2(pago.monto) }))
      .filter((pago) => pago.monto > 0)
    if (pagosLimpios.length === 0) {
      Swal.fire("Sin pagos", "Registre al menos un pago.", "warning")
      return
    }
    const totalPagado = pagosLimpios.reduce((acc, pago) => acc + pago.monto, 0)
    if (totalPagado < montoParte - 0.01) {
      Swal.fire(
        "Monto insuficiente",
        "La parte " + division.siguienteParte + " es de ₡ " + montoParte +
          ". Falta ₡ " + this.redondear2(montoParte - totalPagado) + ".",
        "warning"
      )
      return
    }
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
      try {
        await this.imprimirTicketParte(datos, datos.pagos || pagosLimpios)
      } catch (e) {
        Swal.fire(
          "Parte registrada",
          "La parte se cobró, pero no se pudo imprimir el ticket. Puede reimprimir desde Facturas.",
          "warning"
        )
      }
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
        pagos: [{ metodo_pago: this.metodoInicial(), monto: nuevaDivision.montoParte, referencia: '' }],
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

  metodoInicial = () =>
    this.state.metodosPago && this.state.metodosPago.length > 0
      ? this.state.metodosPago[0].nombre
      : 'EFECTIVO'

  abrirCobro = async () => {
    const facturaID = this.idFacturaActual()
    if (!facturaID) {
      Swal.fire("Cuenta vacía", "Agregue productos antes de cobrar.", "info")
      return
    }
    if ((this.state.metodosPago || []).length === 0) {
      Swal.fire(
        "Sin métodos de pago",
        "Active al menos un método de pago en Administración.",
        "warning"
      )
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
      pagos: [{ metodo_pago: this.metodoInicial(), monto: total, referencia: '' }],
      vuelto: 0,
      cobrando: false
    })
  }
  cerrarCobro = () => {
    if (this.state.cobrando || this.state.cobrandoParte) return
    this.setState({ showPayModal: false, division: null, cobrandoParte: false, cobrando: false })
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
    this.setState({ pagos: [...this.state.pagos, { metodo_pago: this.state.metodosPago[1] ? this.state.metodosPago[1].nombre : this.metodoInicial(), monto: restante > 0 ? restante : 0, referencia: '' }] }, this.calcularVuelto)
  }
  quitarPago = (index) => {
    const pagos = [...this.state.pagos]
    pagos.splice(index, 1)
    this.setState({ pagos }, this.calcularVuelto)
  }
  cambiarPago = (index, campo, valor) => {
    const pagos = this.state.pagos.map((pago, i) =>
      i === index ? { ...pago, [campo]: valor } : pago
    )
    this.setState({ pagos }, this.calcularVuelto)
  }
  calcularVuelto = () => {
    this.setState({
      vuelto: vueltoDePagos(this.state.pagos, this.objetivoCobro())
    })
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
      cobrando: false,
      cobrandoParte: false
    })
  }
  normalizarBusqueda = (texto) =>
    String(texto || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()

  cargarCategorias = async () => {
    try {
      const [resCat, resTodos] = await Promise.all([
        axios.get(baseUrl + "categorias/"),
        axios.get(baseUrl + "productos/todos").catch(() => null)
      ])
      const categorias = resCat.data || []
      const todos = resTodos && Array.isArray(resTodos.data) ? resTodos.data : []
      if (todos.length > 0) {
        // "Todos" arranca activo, como la casita de Odoo.
        this.setState({
          categoriasBD: categorias,
          productosTodos: todos,
          productosBD: todos,
          categoriaSeleccionada: -1,
          busquedaProducto: ""
        })
      } else {
        const primera = categorias.length > 0 ? categorias[0].idCategoria : 0
        this.setState(
          { categoriasBD: categorias, categoriaSeleccionada: primera },
          () => {
            if (primera) this.cargarProductos(primera)
          }
        )
      }
    } catch (e) {
      // Si falla la carga inicial no se bloquea la pantalla.
    }
  }
  cargarTodosLosProductos = async () => {
    this.setState({ categoriaSeleccionada: -1, busquedaProducto: "" })
    if ((this.state.productosTodos || []).length > 0) {
      this.setState({ productosBD: this.state.productosTodos })
      return
    }
    try {
      const res = await axios.get(baseUrl + "productos/todos")
      const todos = res.data || []
      this.setState({ productosTodos: todos, productosBD: todos })
    } catch (e) {
      // Se conserva lo que ya estaba visible.
    }
  }
  cargarProductos = async (categoria) => {
    const categoriaElegida = { categoriaID: categoria }
    this.setState({ categoriaSeleccionada: categoria, busquedaProducto: "" })
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
      axios.get(baseUrl + "configuracion/comanda").then(res => this.setState({ configComanda: res.data || null })).catch(() => {})
      axios.get(baseUrl + "categoria-impresion/cocina").then(res => this.setState({ categoriasCocina: res.data || [] })).catch(() => {})
      axios.get(baseUrl + "modificadores/grupos").then(res => {
        const set = new Set()
        ;(res.data || []).forEach(g => {
          if (Number(g.Activo) !== 1) return
          ;(g.Categorias || []).forEach(c => set.add(Number(c)))
        })
        this.setState({ categoriasConOpciones: Array.from(set) })
      }).catch(() => {})
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
    window.addEventListener("resize", this.ajustarLayoutPedido)
  }
  // Oculta el precio SOLO cuando no cabe en la tarjeta. Evita que se corte
  // en pantallas donde la grilla de productos queda muy angosta.
  ajustarPreciosProductos = () => {
    const tarjetas = document.querySelectorAll(".TablaProductos .btProductoCard")
    if (tarjetas.length === 0) return
    const lienzo = this._lienzoMedir || (this._lienzoMedir = document.createElement("canvas"))
    const contexto = lienzo.getContext("2d")
    tarjetas.forEach((tarjeta) => {
      const precio = tarjeta.querySelector(".btProductoPrecio")
      if (!precio) return
      precio.classList.remove("precio-oculto")
      const estilo = window.getComputedStyle(tarjeta)
      const relleno =
        (parseFloat(estilo.paddingLeft) || 0) +
        (parseFloat(estilo.paddingRight) || 0)
      const disponible = tarjeta.clientWidth - relleno
      let anchoPrecio = precio.scrollWidth
      if (contexto) {
        const estiloPrecio = window.getComputedStyle(precio)
        contexto.font =
          estiloPrecio.fontWeight + " " + estiloPrecio.fontSize + " " + estiloPrecio.fontFamily
        anchoPrecio = Math.max(anchoPrecio, contexto.measureText(precio.textContent || "").width)
      }
      if (disponible > 0 && (anchoPrecio > disponible + 1 || disponible < 52)) {
        precio.classList.add("precio-oculto")
      }
    })
  }
  actualizarFlechasCategorias = () => {
    const el = this.categoriasRef.current
    if (!el) return
    const maximo = el.scrollWidth - el.clientWidth
    const izquierda = el.scrollLeft > 30
    const derecha = maximo > 30 && el.scrollLeft < maximo - 2
    if (izquierda !== this.state.catPuedeIzq || derecha !== this.state.catPuedeDer) {
      this.setState({ catPuedeIzq: izquierda, catPuedeDer: derecha })
    }
  }
  moverCategorias = (direccion) => {
    const el = this.categoriasRef.current
    if (!el) return
    const paso = Math.max(110, Math.floor(el.clientWidth * 0.85))
    el.scrollBy({ left: direccion * paso, behavior: "smooth" })
    setTimeout(this.actualizarFlechasCategorias, 380)
  }
  ajustarLayoutPedido = () => {
    this.ajustarPreciosProductos()
    this.actualizarFlechasCategorias()
  }
  componentDidUpdate(prevProps, prevState) {
    if (
      prevState.productosBD !== this.state.productosBD ||
      prevState.productosTodos !== this.state.productosTodos ||
      prevState.busquedaProducto !== this.state.busquedaProducto ||
      prevState.categoriaSeleccionada !== this.state.categoriaSeleccionada ||
      prevState.categoriasBD !== this.state.categoriasBD
    ) {
      setTimeout(this.ajustarLayoutPedido, 60)
    }
  }
  componentWillUnmount() {
    window.removeEventListener("resize", this.ajustarLayoutPedido)
  }
  cargarFactura = async (IDFactura) => {
    var Fact = { FacturaID: IDFactura }
    var lista = []
    const lineasTemp = await axios.post(baseUrl + "factura/previus/", Fact)
    const lineas = lineasTemp.data
    for (let i = 0; i < lineas.length; i++) {
      var lineaFactura = this.aplicarModificadoresLinea({
        codigo: lineas[i].codigo,
        idCategoria: lineas[i].idCategoria,
        PrecioBase: lineas[i].PrecioBase,
        FacturaID: lineas[i].FacturaID,
        Cantidad: lineas[i].Cantidad,
        Subtotal: lineas[i].Subtotal,
        Precio: lineas[i].Precio,
        Nombre: lineas[i].Nombre,
        Nota: lineas[i].Nota,
        LineaFacturaID: lineas[i].LineaFacturaID
      }, lineas[i].Modificadores)
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

  pedirNombreCuenta = (titulo, valorInicial, exceptoID) =>
    new Promise((resolve) => {
      this.nombreCuentaResolver = resolve
      this.setState(
        {
          nombreCuentaModal: true,
          nombreCuentaTitulo: titulo,
          nombreCuentaValor: valorInicial || "",
          nombreCuentaError: "",
          nombreCuentaExceptoID: exceptoID || 0
        },
        () => this.enfocarNombreCuenta()
      )
    })

  enfocarNombreCuenta = () => {
    setTimeout(() => {
      const input = this.nombreCuentaInputRef.current
      if (!input) return
      try {
        input.focus()
        input.select()
      } catch (e) {}
    }, 120)
  }

  cerrarNombreCuenta = (valor) => {
    const resolver = this.nombreCuentaResolver
    this.nombreCuentaResolver = null
    this.setState({
      nombreCuentaModal: false,
      nombreCuentaTitulo: "",
      nombreCuentaValor: "",
      nombreCuentaError: "",
      nombreCuentaExceptoID: 0
    })
    if (resolver) resolver(valor)
  }

  cambiarNombreCuenta = (e) => {
    this.setState({ nombreCuentaValor: e.target.value, nombreCuentaError: "" })
  }

  guardarNombreCuenta = () => {
    const nombre = (this.state.nombreCuentaValor || "").trim()
    if (nombre === "") {
      this.setState({ nombreCuentaError: "Escriba un nombre para la cuenta" })
      return
    }
    if (nombre.length > 40) {
      this.setState({ nombreCuentaError: "Máximo 40 caracteres" })
      return
    }
    if (!this.nombreCuentaDisponible(nombre, this.state.nombreCuentaExceptoID)) {
      this.setState({ nombreCuentaError: "Ya existe una cuenta con ese nombre en esta mesa" })
      return
    }
    this.cerrarNombreCuenta(nombre)
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

  // Separa los modificadores guardados en lo visible al cliente
  // (guarniciones) y lo que solo va a cocina (término, etc.).
  esModificadorInterno = (m) =>
    Number(m && m.SoloInterno) === 1 ||
    /t[eé]rmino/i.test(String((m && m.GrupoNombre) || ""))

  aplicarModificadoresLinea = (linea, modificadores) => {
    const mods = Array.isArray(modificadores) ? modificadores : []
    const visibles = mods.filter((m) => !this.esModificadorInterno(m))
    const internos = mods.filter((m) => this.esModificadorInterno(m))
    return {
      ...linea,
      Modificadores: mods,
      Guarniciones: visibles.map((m) => m.ItemNombre).filter(Boolean),
      Termino: internos.map((m) => m.ItemNombre).filter(Boolean).join(', ')
    }
  }

  obtenerGruposCategoria = async (idCategoria) => {
    if (!idCategoria) return []
    try {
      const res = await axios.get(baseUrl + "modificadores/categoria/" + idCategoria)
      return res.data || []
    } catch (e) {
      return []
    }
  }

  categoriaDeProducto = (codigo) => {
    const producto =
      (this.state.productosBD || []).find(
        (p) => Number(p.codigo) === Number(codigo)
      ) ||
      (this.state.productosTodos || []).find(
        (p) => Number(p.codigo) === Number(codigo)
      )
    return producto ? producto.idCategoria : 0
  }

  seleccionInicial = (grupos) => {
    const seleccion = {}
    ;(grupos || []).forEach((grupo) => {
      const items = grupo.Items || []
      seleccion[grupo.GrupoID] = []
      // En un grupo de una sola opción y obligatorio, se sugiere la primera.
      if (grupo.Tipo === "radio" && Number(grupo.Obligatorio) === 1 && items.length > 0) {
        seleccion[grupo.GrupoID] = [items[0].ItemID]
      }
    })
    return seleccion
  }

  seleccionDesdeLinea = (grupos, modificadores) => {
    const seleccion = {}
    ;(grupos || []).forEach((grupo) => {
      seleccion[grupo.GrupoID] = []
    })
    ;(modificadores || []).forEach((mod) => {
      const grupo = (grupos || []).find(
        (g) =>
          String(g.GrupoID) === String(mod.GrupoID) ||
          String(g.Nombre).toUpperCase() === String(mod.GrupoNombre || "").toUpperCase()
      )
      if (!grupo) return
      const item = (grupo.Items || []).find(
        (it) =>
          (mod.ItemID && Number(it.ItemID) === Number(mod.ItemID)) ||
          String(it.Nombre).toUpperCase() === String(mod.ItemNombre || "").toUpperCase()
      )
      if (item && !seleccion[grupo.GrupoID].includes(item.ItemID)) {
        seleccion[grupo.GrupoID].push(item.ItemID)
      }
    })
    return seleccion
  }

  cambiarSeleccionMod = (grupo, itemID) => {
    const seleccion = { ...this.state.modSeleccion }
    const actuales = seleccion[grupo.GrupoID] || []
    if (grupo.Tipo === "radio") {
      seleccion[grupo.GrupoID] = actuales.includes(itemID) ? [] : [itemID]
    } else if (grupo.Tipo === "max2") {
      if (actuales.includes(itemID)) {
        seleccion[grupo.GrupoID] = actuales.filter((id) => id !== itemID)
      } else {
        if (actuales.length >= 2) {
          Swal.fire({
            toast: true,
            position: "top-end",
            icon: "info",
            title: 'Máximo 2 opciones en "' + grupo.Nombre + '"',
            showConfirmButton: false,
            timer: 1800
          })
          return
        }
        seleccion[grupo.GrupoID] = [...actuales, itemID]
      }
    } else {
      seleccion[grupo.GrupoID] = actuales.includes(itemID)
        ? actuales.filter((id) => id !== itemID)
        : [...actuales, itemID]
    }
    this.setState({ modSeleccion: seleccion })
  }

  seleccionAModificadores = (grupos, seleccion) => {
    const salida = []
    ;(grupos || []).forEach((grupo) => {
      const elegidos = seleccion[grupo.GrupoID] || []
      ;(grupo.Items || []).forEach((item) => {
        if (elegidos.includes(item.ItemID)) {
          salida.push({
            GrupoID: grupo.GrupoID,
            GrupoNombre: grupo.Nombre,
            ItemID: item.ItemID,
            ItemNombre: item.Nombre,
            TipoGrupo: grupo.Tipo === "radio" ? "radio" : "checkbox",
            SoloInterno: grupo.SoloInterno ? 1 : 0,
            PrecioExtra: Number(item.PrecioExtra) || 0
          })
        }
      })
    })
    return salida
  }

  agregarALista = async (producto) => {
    if (!producto) return
    // El botón "+" de una línea ya existente sólo incrementa la cantidad.
    if (producto.LineaFacturaID) {
      return this.incrementarLinea(producto)
    }
    const grupos = await this.obtenerGruposCategoria(producto.idCategoria)
    if (grupos.length > 0) {
      this.setState({
        showModModal: true,
        modProducto: producto,
        modLinea: null,
        modGrupos: grupos,
        modSeleccion: this.seleccionInicial(grupos),
        modNota: "",
        modGuardando: false
      })
      return
    }
    await this.agregarProducto(producto, [])
  }

  incrementarLinea = async (lineaFactura) => {
    const lista = [...this.state.factura]
    let indice = lista.findIndex(
      (l) => Number(l.LineaFacturaID) === Number(lineaFactura.LineaFacturaID)
    )
    if (indice === -1) {
      indice = lista.findIndex((l) => l.codigo === lineaFactura.codigo)
    }
    if (indice === -1) return
    const cantidad = Number(lista[indice].Cantidad || 0) + 1
    lista[indice] = {
      ...lista[indice],
      Cantidad: cantidad,
      Subtotal: Number(lista[indice].Precio || 0) * cantidad
    }
    this.setState({ factura: lista }, () => this.actualizarTotal())
    await this.guardarCantidadLinea(lista[indice])
  }

  agregarProducto = async (producto, modificadores, nota = "") => {
    const mesaElegida = { MesaID: cookies.get('MesaID').MesaID, NombreMesa: cookies.get('MesaID').Nombre }
    const lista = [...this.state.factura]
    const seleccion = Array.isArray(modificadores) ? modificadores : []
    const notaLinea = (nota || "").toString().trim().slice(0, 255)

    // Si no hay opciones ni nota, se fusiona con la misma línea.
    if (seleccion.length === 0 && !notaLinea) {
      const indice = lista.findIndex((l) => l.codigo === producto.codigo)
      if (indice !== -1 && !llevaModificadores(lista[indice])) {
        return this.incrementarLinea(lista[indice])
      }
    }

    let idFactura = this.idFacturaActual()
    if (!idFactura) {
      const idFac = await axios.post(baseUrl + "factura/add/", mesaElegida)
      idFactura = idFac.data[0].ID
    }
    const cargosGuardados =
      lista.length === 0 ? await this.guardarCargosPendientes(idFactura) : this.state.cargosAplicados

    const baseLinea = {
      codigo: producto.codigo,
      idCategoria: producto.idCategoria || this.categoriaDeProducto(producto.codigo),
      PrecioBase: Number(producto.precio) || 0,
      FacturaID: idFactura,
      Cantidad: 1,
      Subtotal: Number(producto.precio) || 0,
      Precio: Number(producto.precio) || 0,
      Nombre: producto.nombre,
      Nota: notaLinea || null,
      LineaFacturaID: 0
    }
    const idLineFact = await axios.post(baseUrl + "factura/linea/", baseLinea)
    const extras = seleccion.reduce((acc, m) => acc + (Number(m.PrecioExtra) || 0), 0)
    const precioUnitario = this.redondear2((Number(producto.precio) || 0) + extras)
    const lineaFactura = this.aplicarModificadoresLinea(
      {
        ...baseLinea,
        Precio: precioUnitario,
        Subtotal: precioUnitario,
        LineaFacturaID: idLineFact.data[0].ID
      },
      seleccion
    )
    if (precioUnitario !== (Number(baseLinea.Precio) || 0)) {
      try {
        await this.guardarCantidadLinea(lineaFactura)
      } catch (e) {
        // Se conserva al menos la línea creada; el precio se puede ajustar luego.
      }
    }
    if (seleccion.length > 0 || notaLinea) {
      try {
        await axios.post(baseUrl + "linea/modificadores", {
          LineaFacturaID: lineaFactura.LineaFacturaID,
          Modificadores: seleccion,
          Nota: notaLinea
        })
      } catch (e) {
        // La línea ya quedó creada; se puede reintentar con "Editar".
      }
    }
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
  }

  cerrarModalModificadores = () => {
    this.setState({
      showModModal: false,
      modProducto: null,
      modLinea: null,
      modGrupos: [],
      modSeleccion: {},
      modNota: "",
      modGuardando: false
    })
  }

  confirmarModificadores = async () => {
    const { modGrupos, modSeleccion, modProducto, modLinea, modNota } = this.state
    for (const grupo of modGrupos || []) {
      if (Number(grupo.Obligatorio) === 1 && (modSeleccion[grupo.GrupoID] || []).length === 0) {
        Swal.fire("Falta seleccionar", 'El grupo "' + grupo.Nombre + '" es obligatorio.', "warning")
        return
      }
    }
    const modificadores = this.seleccionAModificadores(modGrupos, modSeleccion)
    const nota = (modNota || "").toString().trim().slice(0, 255)
    const cambiaMods = (modGrupos || []).length > 0
    this.setState({ modGuardando: true })
    try {
      if (modLinea) {
        const payload = {
          LineaFacturaID: modLinea.LineaFacturaID,
          Nota: nota
        }
        if (cambiaMods) payload.Modificadores = modificadores
        await axios.post(baseUrl + "linea/modificadores", payload)
        const extrasNuevos = cambiaMods
          ? modificadores.reduce((acc, m) => acc + (Number(m.PrecioExtra) || 0), 0)
          : 0
        const extrasViejos = (modLinea.Modificadores || []).reduce(
          (acc, m) => acc + (Number(m.PrecioExtra) || 0),
          0
        )
        const base =
          modLinea.PrecioBase !== undefined && modLinea.PrecioBase !== null
            ? Number(modLinea.PrecioBase)
            : Number(modLinea.Precio || 0) - extrasViejos
        const precio = this.redondear2(base + extrasNuevos)
        let actualizada = null
        const lista = (this.state.factura || []).map((linea) => {
          if (Number(linea.LineaFacturaID) !== Number(modLinea.LineaFacturaID)) return linea
          let nueva = { ...linea, Nota: nota || null }
          if (cambiaMods) {
            nueva = this.aplicarModificadoresLinea(
              {
                ...nueva,
                Precio: precio,
                Subtotal: this.redondear2(precio * Number(linea.Cantidad || 1))
              },
              modificadores
            )
          }
          actualizada = nueva
          return nueva
        })
        if (actualizada && cambiaMods) {
          try {
            await this.guardarCantidadLinea(actualizada)
          } catch (e) {
            // la selección ya quedó guardada
          }
        }
        this.setState({
          factura: lista,
          showModModal: false,
          modProducto: null,
          modLinea: null,
          modGrupos: [],
          modSeleccion: {},
          modNota: "",
          modGuardando: false
        }, () => this.actualizarTotal())
      } else if (modProducto) {
        const producto = modProducto
        this.setState({
          showModModal: false,
          modProducto: null,
          modLinea: null,
          modGrupos: [],
          modSeleccion: {},
          modNota: "",
          modGuardando: false
        })
        await this.agregarProducto(producto, modificadores, nota)
      } else {
        this.cerrarModalModificadores()
      }
    } catch (e) {
      this.setState({ modGuardando: false })
      Swal.fire("Error", "No se pudieron guardar las opciones del producto.", "error")
    }
  }

  editarModificadores = async (lineaFactura) => {
    if (!lineaFactura) return
    const idCategoria = lineaFactura.idCategoria || this.categoriaDeProducto(lineaFactura.codigo)
    const grupos = await this.obtenerGruposCategoria(idCategoria)
    let guardados = lineaFactura.Modificadores || []
    if (grupos.length > 0) {
      try {
        const res = await axios.get(
          baseUrl + "linea/" + lineaFactura.LineaFacturaID + "/modificadores"
        )
        if (Array.isArray(res.data)) guardados = res.data
      } catch (e) {
        // se usan los que ya tenía en pantalla
      }
    }
    this.setState({
      showModModal: true,
      modProducto: null,
      modLinea: lineaFactura,
      modGrupos: grupos,
      modSeleccion: grupos.length > 0 ? this.seleccionDesdeLinea(grupos, guardados) : {},
      modNota: lineaFactura.Nota || "",
      modGuardando: false
    })
  }

  lineaTieneOpciones = (linea) => {
    if (!linea) return false
    if (Array.isArray(linea.Modificadores) && linea.Modificadores.length > 0) return true
    const idCategoria = Number(linea.idCategoria)
    return (this.state.categoriasConOpciones || []).includes(idCategoria)
  }

  renderModResumen = (linea) => {
    const mods = (linea && linea.Modificadores) || []
    const nota = (linea && linea.Nota ? String(linea.Nota).trim() : "")
    if (mods.length === 0 && !nota) return null
    const visibles = mods.filter((m) => !this.esModificadorInterno(m))
    const internos = mods.filter((m) => this.esModificadorInterno(m))
    return (
      <div className="mod-resumen">
        {visibles.length > 0 && <div>+ {visibles.map((m) => m.ItemNombre).join(", ")}</div>}
        {internos.length > 0 && (
          <div className="mod-resumen-interno">
            {internos.map((m) => m.GrupoNombre + ": " + m.ItemNombre).join(" · ")}
          </div>
        )}
        {nota && (
          <div className="nota-linea">
            <i className="bi bi-chat-left-text"></i> {nota}
          </div>
        )}
      </div>
    )
  }

  confirmarEliminarLinea = async (linea) => {
    if (!linea) return
    const confirmacion = await Swal.fire({
      title: "Quitar del pedido",
      html:
        "<strong>" +
        escapar(linea.Nombre) +
        "</strong><br/><span>¿Seguro que desea quitarlo?</span>",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Quitar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280"
    })
    if (confirmacion.isConfirmed) {
      this.eliminarLinea(linea)
    }
  }

  renderLineasPedidoMovil = (enDivision) => {
    const lineas = this.state.factura || []
    return (
      <div className="solo-movil">

        {lineas.length === 0 && (
          <div className="linea-movil-vacia">Todavía no hay productos en esta cuenta.</div>
        )}

        {lineas.map((linea) => (
          <div className="linea-movil" key={linea.LineaFacturaID || linea.codigo}>
            <div className="linea-movil-top">
              <div className="linea-movil-nombre">
                {linea.Nombre}
                {this.renderModResumen(linea)}
              </div>
              <div className="linea-movil-subtotal">₡ {linea.Subtotal}</div>
            </div>

            <div className="linea-movil-bajo">
              <div className="linea-movil-cantidad">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => this.eliminarUnProducto(linea)}
                  title="Quitar una unidad"
                  aria-label="Quitar una unidad"
                >
                  <i className="bi bi-dash-lg"></i>
                </button>
                <span>{linea.Cantidad}</span>
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  onClick={() => this.agregarALista(linea)}
                  title="Agregar una unidad"
                  aria-label="Agregar una unidad"
                >
                  <i className="bi bi-plus-lg"></i>
                </button>
              </div>
              <span className="linea-movil-precio-unit">₡ {linea.Precio} c/u</span>
            </div>

            <div className="linea-movil-acciones">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => this.editarModificadores(linea)}
              >
                <i
                  className={
                    "bi " + (this.lineaTieneOpciones(linea) ? "bi-sliders" : "bi-chat-left-text")
                  }
                ></i>{" "}
                {this.lineaTieneOpciones(linea) ? "Opciones" : "Nota"}
              </button>
              <button
                type="button"
                className="btn btn-outline-info btn-sm"
                onClick={() => this.moverLinea(linea)}
                disabled={enDivision}
                title={
                  enDivision
                    ? "Termine la división para mover productos"
                    : "Mover a otra cuenta"
                }
              >
                <i className="bi bi-arrow-left-right"></i> Mover
              </button>
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                onClick={() => this.confirmarEliminarLinea(linea)}
              >
                <i className="bi bi-trash"></i> Quitar
              </button>
            </div>
          </div>
        ))}
      </div>
    )
  }

  renderModalModificadores = () => {
    const { modGrupos, modSeleccion, modProducto, modLinea, modNota, modGuardando } = this.state
    const nombre = (modLinea && modLinea.Nombre) || (modProducto && modProducto.nombre) || ""
    const tieneGrupos = (modGrupos || []).length > 0
    return (
      <Modal show={this.state.showModModal} onHide={this.cerrarModalModificadores} centered className="mod-modal">
        <Modal.Header closeButton>
          <Modal.Title>
            {tieneGrupos
              ? modLinea
                ? "Editar opciones"
                : "Elegir opciones"
              : "Nota para cocina"}
            {nombre ? " · " + nombre : ""}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ maxHeight: "65vh", overflowY: "auto" }}>
          {!tieneGrupos && (
            <div className="mod-sin-grupos">
              <i className="bi bi-info-circle"></i> Este producto no tiene guarniciones ni
              términos configurados. Puedes dejar una nota para cocina.
            </div>
          )}

          <div className="mod-nota-campo">
            <label htmlFor="mod-nota">
              <i className="bi bi-chat-left-text"></i> Nota para cocina{" "}
              <span>(opcional)</span>
            </label>
            <textarea
              id="mod-nota"
              rows="2"
              maxLength="255"
              value={modNota}
              onChange={(e) => this.setState({ modNota: e.target.value })}
              placeholder="Ej. sin cebolla, sin queso, bien cocido..."
            />
            <div className="mod-nota-ayuda">
              Se imprime en la comanda de cocina, no en el ticket del cliente.
            </div>
          </div>

          {(modGrupos || []).map((grupo) => {
            const elegidos = modSeleccion[grupo.GrupoID] || []
            return (
              <div className="mod-grupo" key={grupo.GrupoID}>
                <div className="mod-grupo-titulo">
                  <span>{grupo.Nombre}</span>
                  {Number(grupo.Obligatorio) === 1 && (
                    <span className="mod-obligatorio">obligatorio</span>
                  )}
                  {Number(grupo.SoloInterno) === 1 && (
                    <span className="mod-solo-cocina">solo cocina</span>
                  )}
                </div>
                {(grupo.Items || []).length === 0 && (
                  <div className="text-muted small">Sin opciones configuradas.</div>
                )}
                <div className="mod-opciones-lista">
                  {(grupo.Items || []).map((item) => {
                    const activo = elegidos.includes(item.ItemID)
                    return (
                      <label key={item.ItemID} className={"mod-opcion" + (activo ? " activa" : "")}>
                        <input
                          type={grupo.Tipo === "radio" ? "radio" : "checkbox"}
                          name={"grupo-" + grupo.GrupoID}
                          checked={activo}
                          onChange={() => this.cambiarSeleccionMod(grupo, item.ItemID)}
                        />
                        <span className="mod-opcion-nombre">{item.Nombre}</span>
                        {Number(item.PrecioExtra) > 0 && (
                          <span className="mod-extra">₡ {item.PrecioExtra}</span>
                        )}
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={this.cerrarModalModificadores}>
            Cancelar
          </Button>
          <Button variant="success" onClick={this.confirmarModificadores} disabled={modGuardando}>
            {modGuardando
              ? "Guardando..."
              : modLinea
              ? "Guardar cambios"
              : "Agregar al pedido"}
          </Button>
        </Modal.Footer>
      </Modal>
    )
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
    if (this.state.cobrando) return
    const errorPagos = validarPagos(this.state.pagos)
    if (errorPagos) {
      Swal.fire("Pago inválido", errorPagos, "warning")
      return
    }
    const pagosLimpios = this.state.pagos
      .map((pago) => ({ ...pago, monto: this.redondear2(pago.monto) }))
      .filter((pago) => pago.monto > 0)
    if (pagosLimpios.length === 0) {
      Swal.fire("Sin pagos", "Registre al menos un pago.", "warning")
      return
    }
    const totalPagado = pagosLimpios.reduce((acc, pago) => acc + pago.monto, 0)
    const totalFactura = this.redondear2(this.state.total || 0)
    if (totalPagado < totalFactura - 0.01) {
      Swal.fire(
        "Pago incompleto",
        "Falta ₡ " + this.redondear2(totalFactura - totalPagado) + " por cubrir.",
        "warning"
      )
      return
    }
    const vuelto = vueltoDePagos(pagosLimpios, totalFactura)
    this.setState({ cobrando: true })
    try {
      const respuesta = await axios.post(baseUrl + "factura/pagar/", {
        FacturaID: facturaID,
        pagos: pagosLimpios,
        usuario_id: cookies.get('idUsuario') || null,
        vuelto,
        Total: totalFactura
      })
      const vueltoFinal =
        respuesta.data && respuesta.data.vuelto !== undefined
          ? Number(respuesta.data.vuelto)
          : vuelto
      try {
        await this.imprimirTicketPagado(pagosLimpios, vueltoFinal, totalFactura)
      } catch (e) {
        Swal.fire(
          "Cobro registrado",
          "La cuenta se cobró, pero no se pudo imprimir el ticket. Puede reimprimirlo desde Facturas.",
          "warning"
        )
      }
      try {
        const { cuentas } = await this.cargarCuentas(facturaID)
        const restantes = cuentas || []
        if (restantes.length > 0) {
          // La mesa sigue ocupada: abrir la siguiente cuenta sin salir de la mesa
          this.setState({
            showPayModal: false,
            showCartModal: false,
            cobrando: false,
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
        this.setState({ cobrando: false })
        Swal.fire(
          "Cobro registrado",
          "La cuenta se cobró, pero no se pudo actualizar la pantalla. Revise Facturas o recargue la página.",
          "warning"
        )
      }
    } catch (e) {
      this.setState({ cobrando: false })
      const mensaje =
        (e && e.response && e.response.data && e.response.data.error) ||
        "No se pudo cobrar la factura."
      Swal.fire("No se cobró", mensaje, "error")
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
    this.setState({
      itemsSeleccion: seleccion,
      itemsBase: resumen.base,
      itemsCargos: resumen.cargos,
      itemsTotal: resumen.total,
      pagosItems: pagosNuevos,
      itemsVuelto: vueltoDePagos(pagosNuevos, resumen.total)
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
    if ((this.state.metodosPago || []).length === 0) {
      Swal.fire(
        "Sin métodos de pago",
        "Active al menos un método de pago en Administración.",
        "warning"
      )
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
      cobrando: false,
      itemsSeleccion: {},
      itemsBase: 0,
      itemsCargos: [],
      itemsTotal: 0,
      itemsVuelto: 0,
      pagosItems: [{ metodo_pago: this.metodoInicial(), monto: 0, referencia: '' }]
    })
  }

  cerrarCobroItems = () => {
    if (this.state.cobrando) return
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
    const metodo = this.state.metodosPago[1] ? this.state.metodosPago[1].nombre : this.metodoInicial()
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
    const pagosItems = (this.state.pagosItems || []).map((pago, i) =>
      i === index ? { ...pago, [campo]: valor } : pago
    )
    this.setState({ pagosItems }, this.calcularVueltoItems)
  }

  calcularVueltoItems = () => {
    this.setState({
      itemsVuelto: vueltoDePagos(this.state.pagosItems, this.state.itemsTotal)
    })
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
          Subtotal: this.redondear2(Number(linea.Precio || 0) * cantidad),
          _guarnicionesDetalle: guarnicionesTicket(linea)
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
    const errorPagos = validarPagos(pagosAjustados)
    if (errorPagos) {
      Swal.fire("Pago inválido", errorPagos, "warning")
      return
    }
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
    this.setState({ cobrando: true })
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
      this.setState({ cobrando: false })
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
      cobrando: false,
      itemsSeleccion: {},
      itemsBase: 0,
      itemsCargos: [],
      itemsTotal: 0,
      itemsVuelto: 0,
      pagosItems: [{ metodo_pago: this.metodoInicial(), monto: 0, referencia: '' }]
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
        Subtotal: linea.Subtotal,
        // Solo guarniciones visibles al cliente, con grupo y precio.
        _guarnicionesDetalle: guarnicionesTicket(linea)
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

  imprimirComanda = async () => {
    if (!this.state.factura || this.state.factura.length === 0) {
      alert("No hay productos en la cuenta")
      return
    }
    const config = this.state.configComanda || {
      titulo: 'COMANDA',
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
      leyenda_pie: ''
    }
    const categoriasCocina = this.state.categoriasCocina || []
    const mapCat = {}
    categoriasCocina.forEach(c => {
      if (c.imprimir_cocina) mapCat[c.idCategoria] = true
    })
    const lineasFiltradas = []
    const mapProductos = {}
    const productosParaCocina =
      (this.state.productosTodos || []).length > 0
        ? this.state.productosTodos
        : this.state.productosBD || []
    ;(productosParaCocina || []).forEach(p => {
      mapProductos[p.codigo] = p.idCategoria
    })
    ;(this.state.factura || []).forEach(linea => {
      const idCat = linea.idCategoria || mapProductos[linea.codigo]
      if (idCat && mapCat[idCat]) {
        lineasFiltradas.push(linea)
      }
    })
    if (lineasFiltradas.length === 0) {
      alert("No hay productos para imprimir en cocina con las categorías configuradas")
      return
    }
    const { fecha, hora } = fechaHoraActual()
    const ancho = Number(config.ancho_mm) === 58 ? 58 : 80
    const relleno = ancho === 58 ? "2mm 1.5mm 4mm" : "3mm 2mm 6mm"
    const fuente = Number(config.tamano_fuente) || 9
    const mostrarFecha = Number(config.mostrar_fecha) === 1
    const mostrarHora = Number(config.mostrar_hora) === 1
    const mostrarMesa = Number(config.mostrar_mesa) === 1
    const mostrarCliente = Number(config.mostrar_cliente) === 1
    const mostrarCantidad = Number(config.mostrar_cantidad) === 1
    const mostrarGuarniciones = Number(config.mostrar_guarniciones) === 1
    const mostrarTermino = Number(config.mostrar_termino) === 1
    const leyenda = lineasDeTexto(config.leyenda_pie)

    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comanda</title>
<style>
@page{size:${ancho}mm auto;margin:0}
*{box-sizing:border-box}
body{margin:0;font-family:Arial,Helvetica,sans-serif;font-size:${fuente}px}
.ticket{width:${ancho}mm;padding:${relleno};font-weight:600}
.cab{border-bottom:1px dashed #000;padding-bottom:4px;margin-bottom:6px;text-align:center}
.titulo{font-size:${fuente + 3}px;font-weight:700;letter-spacing:1px}
.info{display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:4px}
.linea{border-bottom:1px dashed #999;margin:6px 0}
.item{display:flex;gap:6px;align-items:flex-start;margin:6px 0}
.cant{min-width:18px;text-align:right}
.detalle{flex:1}
.nombre{font-weight:700}
.sub{font-size:${fuente - 1}px;margin-left:6px}
.nota{font-size:${fuente - 1}px;margin:4px 0 0 6px;padding:2px 4px;border:1px dashed #000;font-weight:700}
.pie{margin-top:10px;text-align:center;font-size:${fuente - 1}px}
</style></head><body><div class="ticket"><div class="cab"><div class="titulo">${escapar(config.titulo || 'COMANDA')}</div>
<div class="info">
${mostrarFecha ? `<span>Fecha: ${escapar(fecha)}</span>` : ''}
${mostrarHora ? `<span>Hora: ${escapar(hora)}</span>` : ''}
${mostrarMesa && this.state.mesaActual ? `<span>Mesa: ${escapar(this.state.mesaActual)}</span>` : ''}
${mostrarCliente && this.state.cliente ? `<span>Cliente: ${escapar(this.state.cliente)}</span>` : ''}
</div></div>
`

    lineasFiltradas.forEach(linea => {
      html += `<div class="item"><div class="cant">${mostrarCantidad ? escapar(linea.Cantidad) : ''}</div><div class="detalle"><div class="nombre">${escapar(linea.Nombre)}</div>`
      const mods = Array.isArray(linea.Modificadores) ? linea.Modificadores : []
      if (mods.length > 0) {
        const visiblesPorGrupo = {}
        const internosPorGrupo = {}
        mods.forEach((m) => {
          const destino = this.esModificadorInterno(m) ? internosPorGrupo : visiblesPorGrupo
          const clave = m.GrupoNombre || 'Extras'
          if (!destino[clave]) destino[clave] = []
          if (m.ItemNombre) destino[clave].push(m.ItemNombre)
        })
        if (mostrarGuarniciones) {
          Object.keys(visiblesPorGrupo).forEach((grupo) => {
            html += `<div class="sub">${escapar(grupo)}: ${escapar(visiblesPorGrupo[grupo].join(', '))}</div>`
          })
        }
        if (mostrarTermino) {
          Object.keys(internosPorGrupo).forEach((grupo) => {
            html += `<div class="sub">${escapar(grupo)}: ${escapar(internosPorGrupo[grupo].join(', '))}</div>`
          })
        }
      } else {
        // Compatibilidad con líneas antiguas que traían el texto ya armado.
        const guarn = linea.Guarniciones || linea.guarniciones || linea.modificadores
        if (mostrarGuarniciones && guarn) {
          if (Array.isArray(guarn)) {
            const texto = guarn
              .map(m => (typeof m === 'string' ? m : m.Nombre || m.nombre || m.descripcion))
              .filter(Boolean)
              .join(', ')
            if (texto) html += `<div class="sub">+ ${escapar(texto)}</div>`
          } else if (typeof guarn === 'string' && guarn.trim()) {
            html += `<div class="sub">+ ${escapar(guarn)}</div>`
          }
        }
        if (mostrarTermino && (linea.Termino || linea.termino)) {
          html += `<div class="sub">Término: ${escapar(linea.Termino || linea.termino)}</div>`
        }
      }
      const nota = (linea.Nota || "").trim()
      if (nota) html += `<div class="nota">Nota: ${escapar(nota)}</div>`
      html += `</div></div>`
    })

    html += `<div class="linea"></div>`
    if (leyenda.length > 0) {
      html += `<div class="pie">${leyenda.map(l => escapar(l)).join('<br>')}</div>`
    }
    html += `</div></body></html>`

    // Usar el mismo sistema de impresión
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)
    const doc = iframe.contentWindow.document
    doc.open()
    doc.write(html)
    doc.close()
    setTimeout(() => {
      try {
        iframe.contentWindow.focus()
        iframe.contentWindow.print()
      } catch (e) {}
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe)
      }, 1000)
    }, 200)
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

  renderNombreCuentaModal = () => {
    const {
      nombreCuentaModal,
      nombreCuentaTitulo,
      nombreCuentaValor,
      nombreCuentaError
    } = this.state
    return (
      <Modal
        show={nombreCuentaModal}
        onHide={() => this.cerrarNombreCuenta(null)}
        onEntered={this.enfocarNombreCuenta}
        centered
        className="cuenta-nombre-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title>{nombreCuentaTitulo || "Nombre de la cuenta"}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form
            onSubmit={(e) => {
              e.preventDefault()
              this.guardarNombreCuenta()
            }}
          >
            <Form.Group>
              <Form.Label>Nombre de la cuenta</Form.Label>
              <Form.Control
                ref={this.nombreCuentaInputRef}
                autoFocus
                type="text"
                inputMode="text"
                autoCapitalize="words"
                autoComplete="off"
                enterKeyHint="done"
                maxLength={40}
                value={nombreCuentaValor}
                onChange={this.cambiarNombreCuenta}
                placeholder="Ej. Ana"
              />
              {nombreCuentaError && (
                <Form.Text className="text-danger d-block">
                  {nombreCuentaError}
                </Form.Text>
              )}
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => this.cerrarNombreCuenta(null)}>
            Cancelar
          </Button>
          <Button variant="success" onClick={this.guardarNombreCuenta}>
            Guardar
          </Button>
        </Modal.Footer>
      </Modal>
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
      .reduce((acc, pago) => {
        const monto = parseFloat(pago.monto || 0)
        return acc + (monto > 0 ? monto : 0)
      }, 0)
    const faltaItems = Math.max(0, this.redondear2(itemsTotal - totalPagosItems))
    const totalPagadoCobro = (this.state.pagos || [])
      .reduce((acc, pago) => {
        const monto = parseFloat(pago.monto || 0)
        return acc + (monto > 0 ? monto : 0)
      }, 0)
    const objetivoCobro = this.objetivoCobro()
    const faltaCobro = Math.max(0, this.redondear2(objetivoCobro - totalPagadoCobro))
    const cuentaActivaInfo = (this.state.cuentas || []).find(
      (cuenta) => Number(cuenta.FacturaID) === Number(this.state.idFactura)
    )
    const enDivision = !!(
      cuentaActivaInfo && Number(cuentaActivaInfo.PartesPagadas || 0) > 0
    )
    const busquedaProducto = this.normalizarBusqueda(this.state.busquedaProducto)
    const productosVisibles = busquedaProducto
      ? (this.state.productosTodos || []).filter(
          (producto) =>
            this.normalizarBusqueda(producto.nombre).includes(busquedaProducto) ||
            String(producto.codigo || "").includes(busquedaProducto)
        )
      : this.state.productosBD || []
    return (
      <body className="App-body">
        <div>
          <Navbar collapseOnSelect expand="lg" bg="dark" variant="dark">
            <Container>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button className="btnNavbar" onClick={() => { window.location.href = "/mesas" }} style={{ padding: "0.3rem 0.7rem" }}>
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
                    <button className="btnNavbar" onClick={() => this.redirectNav("Administracion")}>Administración</button>
                  </Nav.Link>
                  <Nav.Link >
                    <button className="btnNavbar" onClick={() => this.redirectNav("Mesas")}>Mesas</button>
                  </Nav.Link>
                </Nav>
                <div className="navbar-busqueda">
                  <i className="bi bi-search"></i>
                  <input
                    type="search"
                    value={this.state.busquedaProducto}
                    placeholder="Buscar producto..."
                    aria-label="Buscar producto"
                    onChange={(e) => {
                      const valor = e.target.value
                      this.setState({
                        busquedaProducto: valor,
                        categoriaSeleccionada: valor.trim() ? -1 : this.state.categoriaSeleccionada
                      })
                    }}
                  />
                  {this.state.busquedaProducto && (
                    <button
                      type="button"
                      className="btn-limpiar-busqueda"
                      title="Limpiar búsqueda"
                      aria-label="Limpiar búsqueda"
                      onClick={() => this.setState({ busquedaProducto: "" })}
                    >
                      <i className="bi bi-x-lg"></i>
                    </button>
                  )}
                </div>
                <Nav>
                  <Nav.Link>
                    <button className="btnNavbar" onClick={() => this.cerrarSesion()}>Cerrar sesión</button>
                  </Nav.Link>
                </Nav>
              </Navbar.Collapse>
            </Container>
          </Navbar>
        </div>
        <div className="PedidosLayout">
          <div className="Tabla">
            <div className="TablaFactura" style={{ overflowX: "auto" }}>
              
                  {this.renderCuentas()}
                  <div className="cliente">
                    <input type="text" placeholder="Nombre de la cuenta (opcional)" value={this.state.clienteInput} onChange={(e) => this.setState({ clienteInput: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") this.agregarNombreCliente() }} /><button className="btn-success btn-sm" onClick={() => this.agregarNombreCliente()}>Aceptar</button>
                  </div>
                  <h3 className="nombreC">{this.state.cliente ? "Cuenta: " + this.state.cliente : "Cuenta general"}</h3>
                <div className="factura-scroll-wrap">
                <div className="factura-scroll-body" ref={this.listaFacturaRef}>
                  <Table responsive className="table-sm tabla-factura" id="tbF">
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
                          <td>
                            {lineaFactura.Nombre}
                            {this.renderModResumen(lineaFactura)}
                          </td>
                          <td>{this.renderPrecio(lineaFactura)}</td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <button className="btn btn-danger btn-sm" onClick={() => this.eliminarUnProducto(lineaFactura)} title="Quitar una unidad" aria-label="Quitar una unidad">-</button>
                              <span>{lineaFactura.Cantidad}</span>
                              <button className="btn btn-success btn-sm" onClick={() => this.agregarALista(lineaFactura)} title="Agregar una unidad" aria-label="Agregar una unidad">+</button>
                            </div>
                          </td>
                          <td>{lineaFactura.Subtotal}</td>
                          <td>
                            <div className="acciones-linea">
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => this.editarModificadores(lineaFactura)}
                                title={
                                  this.lineaTieneOpciones(lineaFactura)
                                    ? "Guarniciones / término"
                                    : "Nota para cocina"
                                }
                              >
                                <i
                                  className={
                                    "bi " +
                                    (this.lineaTieneOpciones(lineaFactura)
                                      ? "bi-sliders"
                                      : "bi-chat-left-text")
                                  }
                                ></i>
                              </button>
                              <button
                                className="btn btn-info btn-sm btMoverLinea"
                                onClick={() => this.moverLinea(lineaFactura)}
                                disabled={enDivision}
                                title={enDivision ? "Termine la división para mover productos" : "Mover a otra cuenta"}
                              >
                                <i className="bi bi-arrow-left-right"></i>
                              </button>
                              <button className="btn btn-danger btn-sm" onClick={() => this.eliminarLinea(lineaFactura)} title="Eliminar producto" aria-label="Eliminar producto"><i className="bi bi-trash"></i></button>
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
              <div className="factura-total-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
                <label id="lbTotal1">Total</label><label id="lbTotal2">₡ {this.state.total}</label>
              </div>
              <div className="factura-botones" style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "10px" }}>
                <button id="btFactura1" onClick={() => this.imprimirPrefactura()}>Prefactura</button>
                <button id="btComanda" onClick={() => this.imprimirComanda()}><i className="bi bi-printer"></i> Imprimir a cocina</button>
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
                {productosVisibles.map((producto, index) => (
                  <button key={producto.codigo || index} className="btProductoCard" onClick={() => this.agregarALista(producto)}>
                    <span className="btProductoNombre">{producto.nombre}</span>
                    <span className="btProductoPrecio">₡ {producto.precio}</span>
                  </button>
                ))}
                {productosVisibles.length === 0 && (
                  <div className="producto-vacio">
                    <i className="bi bi-search"></i>
                    No se encontraron productos.
                  </div>
                )}
              </div>
            </div>
            <div className="Categorias">
              <button
                type="button"
                className={"cat-flecha cat-flecha-izq" + (this.state.catPuedeIzq ? "" : " oculta")}
                onClick={() => this.moverCategorias(-1)}
                title="Categorías anteriores"
                aria-label="Categorías anteriores"
              >
                <i className="bi bi-chevron-left"></i>
              </button>
              <div
                className="TablaCategoria categorias-scroll"
                ref={this.categoriasRef}
                onScroll={this.actualizarFlechasCategorias}
              >
                <button
                  className={
                    "btCategoria btCategoriaTodos" +
                    (this.state.categoriaSeleccionada === -1 ? " btCategoriaActive" : "")
                  }
                  onClick={this.cargarTodosLosProductos}
                >
                  <i className="bi bi-house-door-fill"></i> Todos
                </button>
                {this.state.categoriasBD.map((categoria, index) => (
                  <button
                    key={index}
                    className={
                      "btCategoria" +
                      (this.state.categoriaSeleccionada === categoria.idCategoria ? " btCategoriaActive" : "")
                    }
                    onClick={() => this.cargarProductos(categoria.idCategoria)}
                  >
                    {categoria.Descripcion}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={"cat-flecha cat-flecha-der" + (this.state.catPuedeDer ? "" : " oculta")}
                onClick={() => this.moverCategorias(1)}
                title="Más categorías"
                aria-label="Más categorías"
              >
                <i className="bi bi-chevron-right"></i>
              </button>
            </div>
          </div>
        </div>
        <button className="cart-fab" onClick={this.toggleCartModal}>
          <i className="bi bi-cart3"></i> <span>Revisar pedido · ₡ {this.state.total} · {this.state.factura.reduce((acc, item) => acc + (item.Cantidad || 0), 0)} items</span>
        </button>
        <Modal show={this.state.showCartModal} onHide={this.toggleCartModal} size="lg" centered className="cart-modal">
          <Modal.Header closeButton>
            <Modal.Title>Revisar pedido - {this.state.mesaActual}</Modal.Title>
          </Modal.Header>
          <Modal.Body style={{ maxHeight: "70vh", overflowY: "auto" }}>
            {this.renderCuentas()}
            <div className="cliente" style={{ marginLeft: 0 }}>
              <input type="text" placeholder="Nombre de la cuenta (opcional)" value={this.state.clienteInput} onChange={(e) => this.setState({ clienteInput: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") this.agregarNombreCliente() }} /><button className="btn-success btn-sm" onClick={() => this.agregarNombreCliente()}>Aceptar</button>
            </div>
            <h3 className="nombreC" style={{ marginLeft: 0 }}>{this.state.cliente ? "Cuenta: " + this.state.cliente : "Cuenta general"}</h3>
            {this.renderLineasPedidoMovil(enDivision)}
            <div className="solo-desktop">
            <Table responsive className="table-sm tabla-factura">
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
                    <td>
                      {lineaFactura.Nombre}
                      {this.renderModResumen(lineaFactura)}
                    </td>
                    <td>{this.renderPrecio(lineaFactura)}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <button className="btn btn-danger btn-sm" onClick={() => this.eliminarUnProducto(lineaFactura)} title="Quitar una unidad" aria-label="Quitar una unidad">-</button>
                        <span>{lineaFactura.Cantidad}</span>
                        <button className="btn btn-success btn-sm" onClick={() => this.agregarALista(lineaFactura)} title="Agregar una unidad" aria-label="Agregar una unidad">+</button>
                      </div>
                    </td>
                    <td>{lineaFactura.Subtotal}</td>
                    <td>
                      <div className="acciones-linea">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => this.editarModificadores(lineaFactura)}
                          title={
                            this.lineaTieneOpciones(lineaFactura)
                              ? "Guarniciones / término"
                              : "Nota para cocina"
                          }
                        >
                          <i
                            className={
                              "bi " +
                              (this.lineaTieneOpciones(lineaFactura)
                                ? "bi-sliders"
                                : "bi-chat-left-text")
                            }
                          ></i>
                        </button>
                        <button
                          className="btn btn-info btn-sm btMoverLinea"
                          onClick={() => this.moverLinea(lineaFactura)}
                          disabled={enDivision}
                          title={enDivision ? "Termine la división para mover productos" : "Mover a otra cuenta"}
                        >
                          <i className="bi bi-arrow-left-right"></i>
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => this.eliminarLinea(lineaFactura)} title="Eliminar producto" aria-label="Eliminar producto"><i className="bi bi-trash"></i></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            </div>
            {this.renderCargos()}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
              <strong>Total</strong>
              <strong>₡ {this.state.total}</strong>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={this.toggleCartModal}>Seguir agregando</Button>
            <Button variant="primary" className="accion-cobro" onClick={() => this.imprimirPrefactura()}>Prefactura</Button>
            <Button className="btn-imprimir-cocina" onClick={() => this.imprimirComanda()}><i className="bi bi-printer"></i> Imprimir a cocina</Button>
            <Button variant="outline-primary" className="accion-cobro" onClick={this.abrirCobroItems} disabled={enDivision}>
              Cobrar por ítems
            </Button>
            <Button variant="outline-success" className="accion-cobro" onClick={this.iniciarDivision}>
              <i className="bi bi-people"></i> {enDivision ? "Continuar división" : "Dividir"}
            </Button>
            <Button variant="success" className="accion-cobro" onClick={() => this.abrirCobro()}>Cobrar</Button>
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
            <div className="pay-titulo">Forma de pago</div>
            <div className="pay-cabecera">
              <span>Método de pago</span>
              <span>Monto recibido</span>
              <span></span>
            </div>
            {this.state.pagos.map((pago, index) => (
              <div className="pay-fila" key={index}>
                <Form.Select
                  value={pago.metodo_pago}
                  aria-label="Método de pago"
                  onChange={(e) => this.cambiarPago(index, 'metodo_pago', e.target.value)}
                >
                  {this.state.metodosPago.map((m, mi) => (
                    <option key={mi} value={m.nombre}>{m.nombre}</option>
                  ))}
                </Form.Select>
                <Form.Control
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="Monto"
                  aria-label="Monto recibido"
                  value={pago.monto}
                  onChange={(e) => this.cambiarPago(index, 'monto', e.target.value)}
                  onBlur={this.calcularVuelto}
                />
                {this.state.pagos.length > 1 ? (
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => this.quitarPago(index)}
                    title="Quitar pago"
                    aria-label="Quitar pago"
                  >
                    <i className="bi bi-x"></i>
                  </Button>
                ) : (
                  <span></span>
                )}
              </div>
            ))}
            {faltaCobro > 0.01 && (
              <Button variant="link" onClick={this.agregarPago}>
                <i className="bi bi-plus"></i> Agregar otro pago
              </Button>
            )}

            <div className="pay-resumen">
              <div>
                <span>Pagado</span>
                <strong>₡ {this.redondear2(totalPagadoCobro)}</strong>
              </div>
              <div className={faltaCobro > 0 ? "falta" : "vuelto"}>
                <span>{faltaCobro > 0 ? "Falta por cubrir" : "Vuelto (solo efectivo)"}</span>
                <strong>
                  ₡ {faltaCobro > 0 ? faltaCobro : this.state.vuelto}
                </strong>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={this.cerrarCobro} disabled={this.state.cobrando || this.state.cobrandoParte}>
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
              <Button variant="success" onClick={this.cobrarFactura} disabled={this.state.cobrando}>
                <i className="bi bi-check-lg"></i>{" "}
                {this.state.cobrando ? "Cobrando..." : "Cobrar e imprimir"}
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
            <div className="pay-cabecera">
              <span>Método de pago</span>
              <span>Monto recibido</span>
              <span></span>
            </div>
            {(this.state.pagosItems || []).map((pago, index) => (
              <div className="pay-fila" key={index}>
                <Form.Select
                  value={pago.metodo_pago}
                  aria-label="Método de pago"
                  onChange={(e) => this.cambiarPagoItems(index, 'metodo_pago', e.target.value)}
                >
                  {this.state.metodosPago.map((metodo, indice) => (
                    <option key={indice} value={metodo.nombre}>{metodo.nombre}</option>
                  ))}
                </Form.Select>
                <Form.Control
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="Monto"
                  aria-label="Monto recibido"
                  value={pago.monto}
                  onChange={(e) => this.cambiarPagoItems(index, 'monto', e.target.value)}
                  onBlur={this.calcularVueltoItems}
                />
                {this.state.pagosItems.length > 1 ? (
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => this.quitarPagoItems(index)}
                    title="Quitar pago"
                    aria-label="Quitar pago"
                  >
                    <i className="bi bi-x"></i>
                  </Button>
                ) : (
                  <span></span>
                )}
              </div>
            ))}
            {faltaItems > 0.01 && (
              <Button variant="link" onClick={this.agregarPagoItems}>
                <i className="bi bi-plus"></i> Agregar otro pago
              </Button>
            )}
            <div className="pay-resumen">
              <div>
                <span>Pagado</span>
                <strong>₡ {this.redondear2(totalPagosItems)}</strong>
              </div>
              <div className={faltaItems > 0 ? "falta" : "vuelto"}>
                <span>{faltaItems > 0 ? "Falta por cubrir" : "Vuelto (solo efectivo)"}</span>
                <strong>₡ {faltaItems > 0 ? faltaItems : this.state.itemsVuelto}</strong>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={this.cerrarCobroItems} disabled={this.state.cobrando}>Cancelar</Button>
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
              disabled={!hayItemsSeleccionados || this.state.cobrando}
            >
              <i className="bi bi-check-lg"></i>{" "}
              {this.state.cobrando ? "Cobrando..." : "Cobrar selección e imprimir"}
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

        {this.renderModalModificadores()}
        {this.renderNombreCuentaModal()}
      </body>
    );
  }
}

export default pedidos;
