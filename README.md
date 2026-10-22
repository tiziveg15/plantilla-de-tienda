# Mercado Nube

Tienda React con cuentas de clientes, administración de inventario y checkout alojado por Mercado Pago.

## Iniciar en la computadora

1. Instala Node.js 18 o posterior.
2. Copia `.env.example` como `.env` y completa `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
3. Para probar pagos, completa también `MERCADOPAGO_ACCESS_TOKEN` con credenciales de prueba.
4. Ejecuta `npm start` desde esta carpeta y abre `http://localhost:4173`.

Los datos de productos, pedidos y cuentas quedan en `data/store.json`; las contraseñas de clientes se guardan como hashes scrypt. El botón **Mi cuenta** permite registrarse e iniciar sesión; el acceso de administrador está separado en el pie de página y usa únicamente `ADMIN_EMAIL` y `ADMIN_PASSWORD`. El administrador puede crear, editar, ajustar stock y eliminar productos desde su panel. Los compradores registrados ven solo sus propios pedidos. No guardamos números, códigos de seguridad ni vencimientos de tarjetas. El comprador ingresa los datos en el checkout de Mercado Pago; Mercado Pago identifica la marca y autoriza o rechaza el intento de pago.

## Activar pagos reales

- Crea una aplicación de vendedor en Mercado Pago Developers y usa su Access Token de producción en el servidor.
- Publica la tienda detrás de HTTPS y configura `SITE_URL` con el dominio público exacto.
- Configura el webhook de pagos de Mercado Pago para `https://TU-DOMINIO/api/webhooks/mercadopago` y copia su clave secreta a `MERCADOPAGO_WEBHOOK_SECRET`.
- Cambia `ADMIN_EMAIL` y `ADMIN_PASSWORD` por credenciales privadas y únicas. No publiques `.env`.
- Prueba primero con credenciales y tarjetas de prueba en el entorno de prueba del proveedor.

El checkout crea el pedido y reserva el stock por 30 minutos. El webhook firmado consulta el pago directamente a Mercado Pago; solo un estado aprobado confirma el pedido. Si se rechaza o vence, se libera la reserva. Al aprobarse queda **En preparación**; el administrador lo marca **Enviado** cuando efectivamente entrega el paquete al transporte y luego puede marcarlo **Entregado**.

La página de retorno del pago es solo informativa: el navegador no puede confirmar una transacción. La confirmación válida llega del webhook del proveedor.