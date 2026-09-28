# Recorrido de la demo

Un recorrido guiado por lo que hace Conserje, una función por sección. Síguelo
para probar el producto, o úsalo como guion de tomas al grabar un screencast.

Conserje no es una sola pantalla. Un lead empieza como una conversación en el
navegador y termina como una notificación en el móvil, un correo y una fila en
una hoja de cálculo, así que la mayoría de los clips saltan entre ventanas.
Cada sección dice cuáles tener abiertas.

*English version: [demo.md](demo.md)*

## Preparación, una sola vez

Los clips 1 a 5 corren contra el despliegue real: el chat de
[carlosrendon.co](https://carlosrendon.co), el backend en Netlify y el
workflow en n8n Cloud. No hace falta levantar nada en local.

Deja estas ventanas listas antes de grabar:

| Ventana | Qué muestra |
|---|---|
| carlosrendon.co | El widget, abajo a la derecha |
| Telegram (escritorio o web) | Los avisos del bot de Conserje |
| Un buzón de prueba | El correo que recibe el lead. Usa una dirección distinta a la del remitente, para que el correo se vea como lo vería un visitante real |
| La hoja del CRM | Una fila por lead |
| n8n → *Conserje - lead routing* → Executions | Qué rama tomó cada lead |

El clip 6 corre en local; su preparación está en esa sección.

## Reiniciar, entre tomas

Una conversación termina cuando el asistente registra el lead, y una
conversación terminada no se puede reabrir. Para empezar otra, abre la consola
del navegador en carlosrendon.co y ejecuta:

```js
Conserje.reset()
```

Cada toma crea un lead real: un aviso en Telegram, un correo y una fila en la
hoja. Borra las filas de prueba al terminar. El límite es de 60 mensajes por
visitante y hora, suficiente para varias tomas seguidas.

---

## 1 · La conversación

**Muestra:** una conversación corta en lugar de un formulario, y al asistente
preguntando justo lo que falta.

Abre el widget y escribe, un mensaje a la vez, esperando cada respuesta:

1. `Hola, tengo una clínica dental y quiero un asistente en mi web que responda preguntas y agende citas automáticamente.`
2. `Ya tengo una web en WordPress, pero hoy todo lo hacemos por teléfono y WhatsApp a mano.`
3. `Es urgente, lo necesito esta semana: arranca una campaña de publicidad.`
4. `Tengo más de 40 mil dólares de presupuesto.`
5. `Me llamo Laura Gómez, mi correo es <buzón de prueba>`

Si el asistente pregunta en otro orden, responde con la línea que corresponda.
Tras el último mensaje, agradece y cierra la conversación.

**La idea:** el asistente pregunta por presupuesto, plazo y contacto porque la
configuración del sitio los pide, y nunca da un precio ni una fecha porque la
configuración se lo prohíbe. El visitante no ve nada de la calificación.

---

## 2 · Lo que llega

**Muestra:** el mismo lead llegando a tres sitios, segundos después de terminar
la conversación.

Justo después del clip 1, corta a:

1. **Telegram.** *🔥 Hot lead from Carlos Rendon (score …)*, con el nombre, el
   correo, la banda de presupuesto, el plazo y un resumen escrito para quien
   hará el seguimiento.
2. **El buzón de prueba.** *Recibí tu mensaje — Carlos Rendon*, enviado desde la
   dirección de Carlos. Cita lo que pidió el visitante, con sus palabras, no el
   resumen interno. Si responde, le llega directamente a Carlos.
3. **La hoja.** Una fila nueva: nivel, puntuación, contacto, la necesidad, la
   transcripción completa y `status` = `new`.

**La idea:** el aviso es para quien tiene que actuar; el correo es para el
visitante; la hoja es el registro. Nadie tuvo que copiar nada de un lado a otro.

---

## 3 · Caliente, tibio, frío

**Muestra:** el enrutado por puntuación, y que la puntuación se calcula, no se
adivina.

Haz tres conversaciones, reiniciando entre ellas.

**Caliente:** la conversación del clip 1. Puntúa 85 o más.

**Tibio:**
1. `Hi, I run a small online store and I'd like to automate order status emails and customer support replies.`
2. `We use Shopify, nothing custom built yet.`
3. `Next month would be ideal.`
4. `Budget is around 25k.`
5. `I'm James Carter, my email is <buzón de prueba>`

**Frío:**
1. `Hola, solo estoy explorando qué se puede hacer con IA, sin nada concreto todavía.`
2. `No tengo presupuesto definido ni fecha, solo mirando.`
3. `Me llamo Pedro, pedro@example.com`

Luego abre n8n → Executions y recorre las tres ejecuciones:

| Nivel | Rama | Telegram | Correo | Hoja |
|---|---|---|---|---|
| Caliente | Alert me now → Reply to hot lead | 🔥 Hot lead | "Te escribo hoy mismo" | Fila |
| Tibio | Alert me quietly → Reply to lead | New lead | "En los próximos días" | Fila |
| Frío | Hold for nurture | — | — | Fila |

**La idea:** el modelo extrae los datos; el servidor los puntúa. El presupuesto
vale 45 puntos, el plazo 30, el contacto 15 y el contexto 10, y los umbrales se
definen por sitio. Las mismas respuestas siempre caen en el mismo nivel, y las
reglas están en `server/src/qualification/scorer.ts`, no en un prompt.

---

## 4 · Su idioma

**Muestra:** el asistente y el correo siguen el idioma del visitante, no el del
sitio.

El sitio de Carlos está configurado en español. Reinicia y repite la
conversación tibia del clip 3, en inglés. El asistente responde en inglés, y el
correo llega como *Got your message — Carlos Rendon*.

**La idea:** el asistente anota el idioma del visitante en el lead, y el
workflow elige la plantilla del correo según ese dato. Una sola configuración
de sitio atiende visitantes en cualquiera de los dos idiomas.

---

## 5 · No se pierde nada

**Muestra:** un lead sobrevive a que n8n esté caído, y se entrega una sola vez
cuando vuelve.

1. En n8n, abre *Conserje - lead routing* y haz **Unpublish**.
2. Reinicia el widget y repite la conversación caliente del clip 1. El
   visitante recibe la despedida de siempre; nada de su lado sugiere un
   problema.
3. Muestra Telegram y la hoja: no llegó nada.
4. En Netlify → Logs → Functions → `chat`, muestra la línea
   `lead delivery failed for site 'carlosrendon'`. El lead está en el spool.
5. Vuelve a hacer **Publish** del workflow.
6. En Netlify → Logs → Functions → `maintenance`, pulsa **Run now**, o espera
   a la siguiente hora en punto. El log dice `1 leads delivered, 0 still spooled`.
7. Corta a Telegram: el aviso llega, una sola vez.

**La idea:** el visitante ya hizo su parte, así que una caída más adelante
nunca es su problema. Un lead que no se puede entregar se guarda en el spool y
se reintenta cada hora. El workflow responde en cuanto autentica el lead, así
que un paso que falle después no puede hacer que el backend lo reenvíe; y tras
24 reintentos fallidos el lead se aparta en lugar de reintentarse para siempre.

---

## 6 · Un segundo sitio

**Muestra:** añadir un cliente es un archivo de configuración, no un cambio de
código.

Este clip corre en local, con una clínica dental ficticia cuyos leads van al
mismo workflow de n8n.

**Preparación.** Pon esto en `server/.env`, junto al `ANTHROPIC_API_KEY` que ya
está ahí:

```bash
CONSERJE_WEBHOOK_TOKEN=<el mismo valor que en Netlify>
CONSERJE_WEBHOOK_ACME=https://carlosrendon.app.n8n.cloud/webhook/conserje-lead
```

Luego, en dos terminales, levanta el backend con los sitios de ejemplo y el
servidor de la demo del widget:

```bash
# terminal 1
cd server
CONSERJE_SITES_DIR=../examples/sites node --experimental-strip-types --env-file=.env bin/serve.ts

# terminal 2
cd widget
node build.mjs && node serve-demo.mjs
```

**Graba:**

1. Abre `examples/sites/acme-dental.json`. Señala `businessContext`, `collect`,
   las dos bandas de presupuesto y `allowedOrigins`.
2. Genera su snippet de embebido:
   ```bash
   CONSERJE_SITES_DIR=examples/sites node --experimental-strip-types server/bin/print-embed.ts acme-dental \
     --endpoint=http://localhost:8000/chat --script=/dist/conserje.js
   ```
3. Abre <http://localhost:8080/demo/acme-dental.html>. El mismo widget, otro
   saludo, otro negocio.
4. Ten la conversación:
   1. `Hi, I cracked a crown last night and it really hurts.`
   2. `I'd like a full plan this time: the crown, and whatever else it turns out to need.`
   3. `As soon as possible, this week if you can.`
   4. `Maria Lopez, 0412 345 678, <buzón de prueba>`
5. Corta a Telegram: *🔥 Hot lead from Acme Dental*. En la hoja, la fila nueva
   tiene `acme-dental` en la columna `site`.

**La idea:** todo lo que hace de esto una clínica dental y no una consultoría
—qué ofrece, qué preguntar, qué significa "caliente", qué orígenes pueden
embeberlo, adónde van sus leads— vive en un solo archivo JSON. El código es
compartido.
