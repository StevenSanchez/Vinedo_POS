# VinedoPOS

Sistema de punto de venta (POS) para restaurantes y negocios gastronómicos, orientado a operación local en red. Permite administrar mesas y cuentas, tomar pedidos desde PC, tablet o celular, imprimir comandas de cocina, cobrar en efectivo o tarjeta, dividir cuentas y realizar cierres y aperturas de caja con arqueo de efectivo.

## Características principales

- Gestión de mesas, cuentas y clientes.
- Toma de pedidos responsive para PC, tablet y móvil.
- Catálogo de productos, categorías, precios y búsqueda.
- Guarniciones, términos de carne y notas por línea.
- Comanda de cocina configurable e impresión térmica.
- Prefactura, factura y reimpresión desde el histórico.
- Cobro normal, división igualitaria y cobro por ítems.
- Cálculo de vuelto y métodos de pago configurables.
- Cargos por servicio o propina.
- Apertura y cierre de caja con efectivo inicial, arqueo y diferencia.
- Histórico de facturas y cierres.
- Acceso desde celulares y tablets en la red local mediante QR.
- Instalador autónomo para Windows con Node.js y MySQL portables.

## Tecnologías

**Frontend:** React 18, React Router, Bootstrap 5, react-bootstrap, reactstrap, Axios, SweetAlert2, qrcode.react, CSS responsive.

**Backend:** Node.js 16, Express 4, mysql2, CORS, API REST.

**Base de datos:** MySQL 8 (desarrollo) / MySQL portable (instalador), InnoDB y MyISAM.

**Impresión:** HTML/CSS para impresoras térmicas de 58 mm y 80 mm, impresión desde iframe y modo kiosk printing.

**Despliegue:** Inno Setup, scripts `.bat`, Node.js y MySQL portables para Windows.

## Arquitectura

```text
Navegador (PC / tablet / celular)
              |
              | HTTP :9000
              v
     Express + build de React
              |
              | MySQL :3307 (instalador)
              v
       Base de datos vinedopos
```

El backend sirve la API y, en producción, también el frontend compilado. La aplicación está pensada para ejecutarse en una PC del negocio y ser consumida por dispositivos de la misma red local.

## Estructura del repositorio

```text
api/                    API REST en Express
vinedopos/              Aplicación React
  src/js/               Pantallas y lógica del POS
  src/components/       Componentes compartidos (QR, IP local)
  src/css/              Estilos responsive
database/schema.sql     Esquema de la base de datos (sin datos)
README.md
```

## Ejecución local

### Requisitos

- Node.js 16 o superior
- MySQL 8 o superior
- npm

### 1. Base de datos

Crear una base de datos llamada `vinedopos` e importar el esquema:

```bash
mysql -u root -p -e "CREATE DATABASE vinedopos CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
mysql -u root -p vinedopos < database/schema.sql
```

Después debe existir al menos un usuario en la tabla `usuario` para poder iniciar sesión.

### 2. API

```bash
cd api
npm install
copy config.example.json config.json
npm start
```

Editar `api/config.json` con los datos de conexión de MySQL. La API queda disponible en `http://localhost:9000`.

También se pueden usar variables de entorno:

```text
VINEDOPOS_DB_HOST
VINEDOPOS_DB_PORT
VINEDOPOS_DB_USER
VINEDOPOS_DB_PASSWORD
VINEDOPOS_DB_NAME
VINEDOPOS_API_PORT
```

### 3. Frontend

```bash
cd vinedopos
npm install
npm start
```

El frontend de desarrollo queda en `http://localhost:3000`.

Para producción:

```bash
cd vinedopos
npm run build
```

El backend sirve automáticamente la carpeta `vinedopos/build`.

## Instalador

El instalador de Windows se genera con Inno Setup y empaqueta la API, el frontend compilado, Node.js y MySQL portables. Por tamaño y porque contiene datos de operación, el instalador y los respaldos de producción no se versionan en este repositorio.

## Seguridad

- Las credenciales locales (`api/config.json`), los scripts de diagnóstico y los respaldos de base de datos están excluidos mediante `.gitignore`.
- No se incluyen facturas, cierres ni datos reales de clientes.
- Para producción se recomienda cambiar las contraseñas por defecto y restringir el acceso a la red local.

## Autor

Steven Sánchez — [GitHub](https://github.com/StevenSanchez)
