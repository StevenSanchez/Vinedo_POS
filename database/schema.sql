
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `vinedopos` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `vinedopos`;
DROP TABLE IF EXISTS `caja_apertura`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `caja_apertura` (
  `AperturaID` int NOT NULL AUTO_INCREMENT,
  `monto` decimal(12,2) NOT NULL DEFAULT '0.00',
  `usuario_id` int DEFAULT NULL,
  `usuario` varchar(50) DEFAULT NULL,
  `fecha` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `CierreID` int DEFAULT NULL,
  `activa` tinyint NOT NULL DEFAULT '1',
  PRIMARY KEY (`AperturaID`),
  KEY `idx_caja_apertura_activa` (`activa`),
  KEY `fk_caja_apertura_cierre` (`CierreID`),
  CONSTRAINT `fk_caja_apertura_cierre` FOREIGN KEY (`CierreID`) REFERENCES `cierre_caja` (`CierreID`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `cargo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cargo` (
  `idCargo` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(60) NOT NULL,
  `porcentaje` decimal(5,2) NOT NULL DEFAULT '10.00',
  `predeterminado` tinyint NOT NULL DEFAULT '0',
  `activo` tinyint NOT NULL DEFAULT '1',
  PRIMARY KEY (`idCargo`),
  UNIQUE KEY `uk_cargo_nombre` (`nombre`)
) ENGINE=MyISAM AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `categoria`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `categoria` (
  `idCategoria` int NOT NULL AUTO_INCREMENT,
  `Descripcion` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`idCategoria`),
  UNIQUE KEY `idCategoria_UNIQUE` (`idCategoria`)
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `categoria_impresion_cocina`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `categoria_impresion_cocina` (
  `idCategoria` int NOT NULL,
  `imprimir_cocina` tinyint(1) NOT NULL DEFAULT '0',
  `estacion` varchar(30) DEFAULT 'COCINA',
  `orden` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`idCategoria`),
  CONSTRAINT `fk_cic_categoria` FOREIGN KEY (`idCategoria`) REFERENCES `categoria` (`idCategoria`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `cierre_caja`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cierre_caja` (
  `CierreID` int NOT NULL AUTO_INCREMENT,
  `fecha` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `usuario_id` int DEFAULT NULL,
  `usuario` varchar(50) DEFAULT NULL,
  `desde` datetime DEFAULT NULL,
  `hasta` datetime DEFAULT NULL,
  `facturas` int NOT NULL DEFAULT '0',
  `total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `efectivo_recibido` decimal(12,2) NOT NULL DEFAULT '0.00',
  `vuelto` decimal(12,2) NOT NULL DEFAULT '0.00',
  `efectivo_neto` decimal(12,2) NOT NULL DEFAULT '0.00',
  `efectivo_inicial` decimal(12,2) NOT NULL DEFAULT '0.00',
  `efectivo_contado` decimal(12,2) DEFAULT NULL,
  `diferencia` decimal(12,2) DEFAULT NULL,
  `observaciones` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`CierreID`),
  KEY `idx_cierre_fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `cierre_caja_factura`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cierre_caja_factura` (
  `CierreID` int NOT NULL,
  `FacturaID` int NOT NULL,
  `Total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `MesaID` int DEFAULT NULL,
  `NombreMesa` varchar(45) DEFAULT NULL,
  `Cliente` varchar(80) DEFAULT NULL,
  `fecha_cierre` datetime DEFAULT NULL,
  PRIMARY KEY (`CierreID`,`FacturaID`),
  KEY `idx_cierre_factura` (`FacturaID`),
  CONSTRAINT `fk_cierre_factura` FOREIGN KEY (`CierreID`) REFERENCES `cierre_caja` (`CierreID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `cierre_caja_pago`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cierre_caja_pago` (
  `CierrePagoID` int NOT NULL AUTO_INCREMENT,
  `CierreID` int NOT NULL,
  `metodo_pago` varchar(50) NOT NULL,
  `cantidad` int NOT NULL DEFAULT '0',
  `monto` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`CierrePagoID`),
  UNIQUE KEY `uq_cierre_metodo` (`CierreID`,`metodo_pago`),
  CONSTRAINT `fk_cierre_pago` FOREIGN KEY (`CierreID`) REFERENCES `cierre_caja` (`CierreID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `configuracion_comanda`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `configuracion_comanda` (
  `id` tinyint NOT NULL DEFAULT '1',
  `titulo` varchar(40) NOT NULL DEFAULT 'COMANDA',
  `ancho_mm` tinyint NOT NULL DEFAULT '80',
  `tamano_fuente` tinyint NOT NULL DEFAULT '9',
  `mostrar_fecha` tinyint(1) NOT NULL DEFAULT '1',
  `mostrar_hora` tinyint(1) NOT NULL DEFAULT '1',
  `mostrar_mesa` tinyint(1) NOT NULL DEFAULT '1',
  `mostrar_cliente` tinyint(1) NOT NULL DEFAULT '1',
  `mostrar_cantidad` tinyint(1) NOT NULL DEFAULT '1',
  `mostrar_guarniciones` tinyint(1) NOT NULL DEFAULT '1',
  `mostrar_termino` tinyint(1) NOT NULL DEFAULT '1',
  `agrupar_por_estacion` tinyint(1) NOT NULL DEFAULT '0',
  `leyenda_pie` text,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `actualizado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `configuracion_ticket`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `configuracion_ticket` (
  `id` tinyint NOT NULL DEFAULT '1',
  `nombre_negocio` varchar(120) NOT NULL DEFAULT 'La Casa del Viñedo',
  `cedula` varchar(40) DEFAULT NULL,
  `telefono` varchar(40) DEFAULT NULL,
  `direccion` varchar(255) DEFAULT NULL,
  `email` varchar(120) DEFAULT NULL,
  `sitio_web` varchar(120) DEFAULT NULL,
  `encabezado_extra` text,
  `leyenda_pie` text,
  `ancho_mm` tinyint NOT NULL DEFAULT '80',
  `tamano_fuente` tinyint NOT NULL DEFAULT '10',
  `formato_moneda` varchar(10) NOT NULL DEFAULT 'cr',
  `etiqueta_prefactura` varchar(40) NOT NULL DEFAULT 'PREFACTURA',
  `etiqueta_factura` varchar(40) NOT NULL DEFAULT 'FACTURA',
  `mostrar_cedula` tinyint NOT NULL DEFAULT '1',
  `mostrar_telefono` tinyint NOT NULL DEFAULT '1',
  `mostrar_direccion` tinyint NOT NULL DEFAULT '1',
  `mostrar_email` tinyint NOT NULL DEFAULT '0',
  `mostrar_sitio` tinyint NOT NULL DEFAULT '0',
  `mostrar_fecha` tinyint NOT NULL DEFAULT '1',
  `mostrar_hora` tinyint NOT NULL DEFAULT '1',
  `mostrar_mesa` tinyint NOT NULL DEFAULT '1',
  `mostrar_cliente` tinyint NOT NULL DEFAULT '1',
  `mostrar_cajero` tinyint NOT NULL DEFAULT '1',
  `mostrar_numero` tinyint NOT NULL DEFAULT '1',
  `mostrar_cantidad` tinyint NOT NULL DEFAULT '1',
  `mostrar_precio_unitario` tinyint NOT NULL DEFAULT '0',
  `mostrar_subtotal_linea` tinyint NOT NULL DEFAULT '1',
  `mostrar_subtotal` tinyint NOT NULL DEFAULT '0',
  `mostrar_impuesto` tinyint NOT NULL DEFAULT '0',
  `impuesto_porcentaje` decimal(5,2) NOT NULL DEFAULT '13.00',
  `impuesto_incluido` tinyint NOT NULL DEFAULT '1',
  `mostrar_pagos` tinyint NOT NULL DEFAULT '1',
  `mostrar_vuelto` tinyint NOT NULL DEFAULT '1',
  `actualizado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `factura`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `factura` (
  `FacturaID` int NOT NULL AUTO_INCREMENT,
  `MesaID` int DEFAULT NULL,
  `Hora` time DEFAULT NULL,
  `Fecha` date DEFAULT NULL,
  `estado` tinyint NOT NULL DEFAULT '0',
  `Total` double DEFAULT '0',
  `cierre` tinyint NOT NULL DEFAULT '0',
  `NombreMesa` varchar(45) DEFAULT NULL,
  `Cliente` varchar(80) DEFAULT NULL,
  `fecha_cierre` datetime DEFAULT NULL,
  `usuario_cobro` int DEFAULT NULL,
  `vuelto` decimal(10,2) DEFAULT '0.00',
  PRIMARY KEY (`FacturaID`),
  UNIQUE KEY `FacturaID` (`FacturaID`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `factura_cargo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `factura_cargo` (
  `idFacturaCargo` int NOT NULL AUTO_INCREMENT,
  `FacturaID` int NOT NULL,
  `idCargo` int DEFAULT NULL,
  `nombre` varchar(60) NOT NULL,
  `porcentaje` decimal(5,2) NOT NULL,
  PRIMARY KEY (`idFacturaCargo`),
  KEY `idx_factura_cargo_factura` (`FacturaID`)
) ENGINE=MyISAM AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `factura_detalle_modificador`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `factura_detalle_modificador` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `DetalleID` int NOT NULL,
  `ItemID` int DEFAULT NULL,
  `GrupoID` varchar(50) DEFAULT NULL,
  `GrupoNombre` varchar(80) NOT NULL,
  `ItemNombre` varchar(100) NOT NULL,
  `TipoGrupo` enum('radio','checkbox') NOT NULL,
  `SoloInterno` tinyint(1) NOT NULL DEFAULT '0',
  `PrecioExtra` decimal(10,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`ID`),
  KEY `idx_fdm_detalle` (`DetalleID`),
  KEY `idx_fdm_item` (`ItemID`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `lineafactura`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lineafactura` (
  `LineaFacturaID` int NOT NULL AUTO_INCREMENT,
  `ProductoID` int DEFAULT NULL,
  `FacturaID` int DEFAULT NULL,
  `Cantidad` int DEFAULT NULL,
  `Precio` decimal(10,2) DEFAULT NULL,
  `Subtotal` double DEFAULT NULL,
  `Nota` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`LineaFacturaID`),
  UNIQUE KEY `LineaFacturaID` (`LineaFacturaID`),
  KEY `ProductoID` (`ProductoID`),
  KEY `FacturaID` (`FacturaID`),
  CONSTRAINT `lineafactura_ibfk_1` FOREIGN KEY (`ProductoID`) REFERENCES `producto` (`codigo`),
  CONSTRAINT `lineafactura_ibfk_2` FOREIGN KEY (`FacturaID`) REFERENCES `factura` (`FacturaID`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `mesa`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mesa` (
  `MesaID` int NOT NULL AUTO_INCREMENT,
  `Nombre` varchar(25) NOT NULL,
  `orden` int DEFAULT '0',
  PRIMARY KEY (`MesaID`),
  UNIQUE KEY `MesaID` (`MesaID`)
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `metodos_pago`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `metodos_pago` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(50) NOT NULL,
  `activo` tinyint DEFAULT '1',
  `orden` int NOT NULL DEFAULT '0',
  `descripcion` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `modificador_grupo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `modificador_grupo` (
  `GrupoID` int NOT NULL AUTO_INCREMENT,
  `Nombre` varchar(80) NOT NULL,
  `Tipo` enum('radio','checkbox','max2') NOT NULL DEFAULT 'radio',
  `Obligatorio` tinyint(1) NOT NULL DEFAULT '0',
  `SoloInterno` tinyint(1) NOT NULL DEFAULT '0',
  `Orden` int NOT NULL DEFAULT '0',
  `Activo` tinyint(1) NOT NULL DEFAULT '1',
  `CreadoEn` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `CobrarPrecio` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`GrupoID`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `modificador_grupo_categoria`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `modificador_grupo_categoria` (
  `GrupoID` int NOT NULL,
  `CategoriaID` int NOT NULL,
  PRIMARY KEY (`GrupoID`,`CategoriaID`),
  KEY `idx_mgc_categoria` (`CategoriaID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `modificador_grupo_categoria_origen`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `modificador_grupo_categoria_origen` (
  `GrupoID` int NOT NULL,
  `CategoriaID` int NOT NULL,
  PRIMARY KEY (`GrupoID`,`CategoriaID`),
  KEY `idx_mgco_categoria` (`CategoriaID`),
  CONSTRAINT `fk_mgco_categoria` FOREIGN KEY (`CategoriaID`) REFERENCES `categoria` (`idCategoria`) ON DELETE CASCADE,
  CONSTRAINT `fk_mgco_grupo` FOREIGN KEY (`GrupoID`) REFERENCES `modificador_grupo` (`GrupoID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `modificador_item`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `modificador_item` (
  `ItemID` int NOT NULL AUTO_INCREMENT,
  `GrupoID` int NOT NULL,
  `Nombre` varchar(100) NOT NULL,
  `PrecioExtra` decimal(10,2) NOT NULL DEFAULT '0.00',
  `Orden` int NOT NULL DEFAULT '0',
  `Activo` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`ItemID`),
  KEY `idx_mod_item_grupo` (`GrupoID`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pagos_factura`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pagos_factura` (
  `id_pago` int NOT NULL AUTO_INCREMENT,
  `FacturaID` int NOT NULL,
  `metodo_pago` varchar(50) NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `fecha` datetime DEFAULT CURRENT_TIMESTAMP,
  `usuario_id` int DEFAULT NULL,
  `referencia` varchar(100) DEFAULT NULL,
  `parte` tinyint unsigned DEFAULT NULL,
  `partes` tinyint unsigned DEFAULT NULL,
  `monto_parte` decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (`id_pago`),
  KEY `idx_pagos_parte` (`FacturaID`,`parte`),
  CONSTRAINT `pagos_factura_ibfk_1` FOREIGN KEY (`FacturaID`) REFERENCES `factura` (`FacturaID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `producto`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `producto` (
  `codigo` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(50) NOT NULL,
  `idCategoria` int NOT NULL,
  `descripcion` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `precio` double NOT NULL,
  PRIMARY KEY (`codigo`),
  UNIQUE KEY `codigo_UNIQUE` (`codigo`),
  KEY `idcategoria_idx` (`idCategoria`),
  CONSTRAINT `idcategoria` FOREIGN KEY (`idCategoria`) REFERENCES `categoria` (`idCategoria`)
) ENGINE=InnoDB AUTO_INCREMENT=365 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `usuario`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuario` (
  `idUsuario` int NOT NULL AUTO_INCREMENT,
  `usuario` varchar(50) NOT NULL,
  `contraseña` varchar(255) NOT NULL,
  PRIMARY KEY (`idUsuario`),
  UNIQUE KEY `idUsuario_UNIQUE` (`idUsuario`),
  UNIQUE KEY `Usuario_UNIQUE` (`usuario`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

