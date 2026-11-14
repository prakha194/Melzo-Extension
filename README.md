# YouTube Music per Myspoti

Adattamento funzionale per Myspoti ispirato all'estensione YouTube Music per Echo: collega le tracce Spotify a brani ufficiali YouTube Music e propone l'audio AAC/M4A per riproduzione e download. Non è una conversione automatica del codice Kotlin di Echo. È basato sul progetto GPL di y-exe (vedi Provenienza).

## Installazione

1. Usa Myspoti **2.0.2 o successivo** e copia `extension.zip` sul dispositivo.
2. Apri **Impostazioni → Estensioni → Installa da file**, seleziona lo ZIP, leggi e accetta le autorizzazioni.
3. In **Impostazioni → Riproduzione → sorgenti audio**, sposta questa estensione sopra Spotify; altrimenti Spotify viene interrogato prima e l'estensione non viene usata per lo streaming.
4. Per l'offline, abilita questa sorgente in **Impostazioni → Download** e scegli la qualità adatta. I download sono gestiti da Myspoti.

Nomi e posizione delle voci possono variare tra versioni. Quando non trova una sorgente compatibile, la riproduzione può passare a Spotify secondo l'ordine impostato.

## Risoluzione problemi

Dalla versione 1.0.1, un HTTP 302 nel controllo di stato non disattiva più la sorgente. Il reindirizzamento dimostra solo che il server risponde: non garantisce che le ricerche o gli stream siano utilizzabili sul dispositivo. Se i brani non partono, controlla il dettaglio degli errori nell’estensione e verifica che sia sopra Spotify nell’ordine delle sorgenti.

## Funzionamento e limiti

- Cerca nel catalogo YouTube Music i brani contrassegnati come registrazioni ufficiali (ATV), confrontando titolo, artisti e durata. La corrispondenza non è una prova d'identità della registrazione e può essere errata.
- Propone solo URL audio AAC/M4A diretti, senza DRM e senza firme cifrate; nessuna decifratura, nessun login o cookie. Alcune tracce, video musicali, brani protetti, versioni live e risultati non ufficiali non sono supportati. Myspoti può rifiutare download di durata o formato non conformi.
- I servizi YouTube possono modificare o limitare gli endpoint, bloccare l'accesso o far scadere gli URL; ciò può impedire il funzionamento, anche dopo un test riuscito. Verifica e rispetta i termini applicabili e i diritti sui contenuti.
- Non trasferisce interfaccia Echo, catalogo navigabile, libreria o playlist YouTube Music, account, video e altre funzioni Echo. Myspoti parte da brani Spotify e richiede una sorgente audio o download per ogni traccia.
- Le richieste sono dirette a music.youtube.com, youtubei.googleapis.com e googlevideo.com; inviano i termini di ricerca al servizio. Nessun server intermedio è previsto.

## Verifica e sviluppo

`manifest.json` e `main.js` sono i sorgenti; `node scripts/pack.js` genera lo ZIP. Il risolutore proviene da [y-exe/myspoti-youtube-music](https://github.com/y-exe/myspoti-youtube-music), commit `37c588fe613245cd7dd5c854cd43c8625824a46e`. La modifica aggiunge la sorgente audio e una scadenza più breve per il suo hook, e limita le attese in caso di rate limiting. Il codice, la licenza GPL-3.0-only e gli avvisi di terze parti sono nel pacchetto sorgente distribuito insieme allo ZIP.

Test di rete con l'harness Node: `node scripts/harness.js test-track.json --full --audio --no-i18n` (senza `--audio` prova il download). I test via rete dipendono dal servizio e non sostituiscono una verifica su dispositivo. Non affiliato a YouTube, Google, Spotify o Myspoti.
