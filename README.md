# HPV Power Dyno

PWA locale per eventi: test di potenza su trike/rullo con Favero Assioma o simulazione DEMO, risultati e classifica persistente.

## Avvio

Richiede Node 20+. Eseguire `npm install`, poi `npm run dev`. Build di produzione: `npm run build`. Test automatici: `npm test`.

## Uso durante l'evento

Inserisci nickname e durata, quindi avvia **DEMO MODE** per provare l'intero flusso senza sensore. Per Assioma, apri l'app in Chrome Android su HTTPS, premi **CONNECT ASSIOMA** e seleziona il pedale. Il pannello Debug BLE mostra stato, batteria e gli ultimi 500 eventi.

Web Bluetooth richiede HTTPS (localhost è l'eccezione). Per Vercel: importa il repository GitHub, usa `npm run build` e pubblica la cartella `dist`.

## Percorsi e simulazione

I tracciati non sono disegnati a mano: la geometria viene da OpenStreetMap (ODbL) ed è congelata in `src/logic/trackData.ts`, quindi l'app resta interamente offline.

- **Monza**: centerline del circuito GP ricomposta dalle way OSM, 5794 m contro i 5793 m ufficiali.
- **Mottarone**: routing OSRM da Armeno, troncato agli 11,7 km ufficiali; quote SRTM ancorate a 538 → 1437 m. Le pendenze per 500 m coincidono con il profilo climbfinder entro 1,1 punti percentuali.
- **Velodromo**: anello standard da 400 m (rettilinei 84,39 m, raggio 36,5 m) sul campo di Gattico, perché in OSM lì non è mappata nessuna pista.

Il mezzo si muove sulla polilinea reale: posizione, rotta, pendenza e raggio di curva sono letti sotto le ruote a ogni campione. Il modello è newtoniano, `a = (spinta − resistenze) / massa`, con resistenze gravità + rotolamento + aria: la massa conta davvero sull'accelerazione e in salita.

La mappa insegue il mezzo con un'inquadratura di circa 55 metri, calcolata sulle dimensioni reali del riquadro perché un livello di zoom fisso mostrerebbe 90 m sul telefono e 300 sul desktop. Il mezzo è cerchiato da un anello colorato — giallo tu, ciano lo sfidante, grigio il record — altrimenti su una foto satellitare la sagoma sparisce. Sui percorsi che salgono la pendenza compare in grande a bordo mappa, illuminata secondo il valore come la potenza, e il profilo altimetrico si restringe a una finestra di 1 km attorno al punto in cui sei, con dislivello fatto e residuo.

Il fondoscala della potenza è 750 W sullo sprint e sul giro di Monza, 500 W sul Mottarone e al velodromo, dove in un'ora di salita si sta sotto quella soglia: quel che sfora resta segnalato come extra.

Il pulsante **GHOST**, sotto i quattro mezzi nella colonna di destra, apre un mini menù: di default non corre nessuno accanto a te. Si può scegliere uno dei quattro mezzi, che percorre il tracciato con **gli stessi watt istante per istante** ma con la sua fisica — in velomobile vedi dove sarebbe la bici da corsa, e viceversa — oppure il **record** sul tracciato, se esiste una prova completata in archivio: quello rigioca i campioni registrati, quindi rallenta dove hai rallentato davvero. Il pannello in alto a destra dà il distacco in metri. Scegliendo un ghost a prova iniziata, parte dalla tua posizione del momento.

Ogni mezzo ha CdA, Crr e accelerazione laterale sostenibile propri (`src/logic/challenges.ts`). La velocità in curva è limitata dalla curvatura del tracciato e la frenata è propagata all'indietro, così si rallenta prima della curva. La taratura è ancorata a rilievi reali in pista con il velomobile: prima variante 38 km/h al limite, Roggia e Ascari sopra i 50 in pieno. Su questi valori il giro simulato a 234 W esce intorno ai 380 s contro i 355 s del record reale: il modello resta un po' conservativo, e il parametro da ritoccare per avvicinarlo è `lateralG`.

## BLE e metriche

Il provider usa il Cycling Power Service `0x1818` e Cycling Power Measurement `0x2A63`. La cadenza viene calcolata soltanto se sono presenti gli standard crank revolution data. Medie e finestre Best 1/5/10 s sono pesate sui timestamp. Ogni sessione registra la sfida a cui appartiene e la classifica è separata per sfida: il dyno sprint è ordinato per Best 5s, le prove a percorso per tempo, con i non completati in fondo. La prova sul Pixel con Assioma reale resta necessaria.

## PWA / offline

Dopo la prima visita, asset UI, demo e database IndexedDB sono disponibili offline. Non sono incluse API key, analytics o backend. `/display` mostra la Top 10 del database locale nello stesso browser/dispositivo.
