/**
 * ============================================================================
 * ARCHIVO: src/components/IpRed.js
 * PROPÓSITO: Mostrar la IP LAN de la PC para conectar desde celulares/tablets
 *            en la misma red. QR para escanear y acceso rápido.
 * ============================================================================
 */
import React from "react";
import axios from "axios";
import { Modal, ModalBody, ModalHeader } from "reactstrap";
import { Button } from "react-bootstrap";
import { QRCodeSVG } from "qrcode.react";
import { ruta } from "../Ruta/ruta";

const baseUrl = ruta.baseUrl;

class IpRed extends React.Component {
  state = {
    ip: "",
    cargando: true,
    modalQr: false
  };

  componentDidMount() {
    this.obtenerIp();
  }

  obtenerIp = async () => {
    try {
      const res = await axios.get(baseUrl + "red/ip");
      this.setState({
        ip: res.data && res.data.ip ? res.data.ip : window.location.hostname,
        cargando: false
      });
    } catch (e) {
      this.setState({
        ip: window.location.hostname || "",
        cargando: false
      });
    }
  };

  copiar = () => {
    const url = `http://${this.state.ip}:9000`;
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url);
      }
    } catch (e) {
      // ignorar
    }
  };

  abrirQr = () => {
    this.setState({ modalQr: true });
  };

  cerrarQr = () => {
    this.setState({ modalQr: false });
  };

  render() {
    if (this.state.cargando || !this.state.ip) return null;
    const url = `http://${this.state.ip}:9000`;
    return (
      <>
        <div
          style={{
            position: "fixed",
            bottom: "6px",
            left: "10px",
            backgroundColor: "rgba(0,0,0,0.75)",
            color: "#fff",
            padding: "4px 8px",
            borderRadius: "8px",
            fontSize: "0.75rem",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: "6px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
            cursor: "pointer"
          }}
          title="Escanear QR para conectar desde celular"
          onClick={this.abrirQr}
        >
          <div style={{ background: "#fff", padding: "2px", borderRadius: "4px", display: "flex" }}>
            <QRCodeSVG value={url} size={28} />
          </div>
          <span>Escanear QR</span>
        </div>

        <div
          style={{
            position: "fixed",
            bottom: "6px",
            right: "10px",
            backgroundColor: "rgba(0,0,0,0.7)",
            color: "#fff",
            padding: "4px 10px",
            borderRadius: "6px",
            fontSize: "0.8rem",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)"
          }}
          title="Conectar desde celular en la misma red"
        >
          <span>
            <i className="bi bi-wifi"></i> Conectar desde celular: <strong>{url}</strong>
          </span>
          <button
            type="button"
            onClick={this.copiar}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.6)",
              color: "#fff",
              borderRadius: "4px",
              padding: "1px 6px",
              fontSize: "0.75rem",
              cursor: "pointer"
            }}
          >
            Copiar
          </button>
        </div>

        <Modal isOpen={this.state.modalQr} toggle={this.cerrarQr} centered>
          <ModalHeader toggle={this.cerrarQr}>
            <span style={{ color: "black", fontWeight: "bold" }}>Conectar desde celular</span>
          </ModalHeader>
          <ModalBody style={{ textAlign: "center", color: "black" }}>
            <p style={{ marginBottom: "12px" }}>Escanea este código QR con la cámara o lector QR</p>
            <div style={{ background: "#fff", display: "inline-block", padding: "12px", borderRadius: "10px", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
              <QRCodeSVG value={url} size={220} />
            </div>
            <p style={{ marginTop: "14px", marginBottom: "10px", wordBreak: "break-all" }}>
              <strong>{url}</strong>
            </p>
            <Button color="secondary" onClick={this.copiar}>
              <i className="bi bi-clipboard me-1"></i> Copiar URL
            </Button>
            <Button color="primary" style={{ marginLeft: "8px" }} onClick={this.cerrarQr}>
              Cerrar
            </Button>
          </ModalBody>
        </Modal>
      </>
    );
  }
}

export default IpRed;
