# HPV Power Dyno

PWA locale per eventi: test di potenza su trike/rullo con Favero Assioma o simulazione DEMO, risultati e classifica persistente.

## Avvio

Richiede Node 20+. Eseguire `npm install`, poi `npm run dev`. Build di produzione: `npm run build`. Test automatici: `npm test`.

## Uso durante l'evento

Inserisci nickname e durata, quindi avvia **DEMO MODE** per provare l'intero flusso senza sensore. Per Assioma, apri l'app in Chrome Android su HTTPS, premi **CONNECT ASSIOMA** e seleziona il pedale. Il pannello Debug BLE mostra stato, batteria e gli ultimi 500 eventi.

Web Bluetooth richiede HTTPS (localhost è l'eccezione). Per Vercel: importa il repository GitHub, usa `npm run build` e pubblica la cartella `dist`.

## BLE e metriche

Il provider usa il Cycling Power Service `0x1818` e Cycling Power Measurement `0x2A63`. La cadenza viene calcolata soltanto se sono presenti gli standard crank revolution data. Medie e finestre Best 1/5/10 s sono pesate sui timestamp: la classifica reale contiene solo sessioni `VALID` ed è ordinata per Best 5s. La prova sul Pixel con Assioma reale resta necessaria.

## PWA / offline

Dopo la prima visita, asset UI, demo e database IndexedDB sono disponibili offline. Non sono incluse API key, analytics o backend. `/display` mostra la Top 10 del database locale nello stesso browser/dispositivo.
