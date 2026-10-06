# Plan: Prototyp för AI-assistent vid köp av telekomtjänster

Fokus: den komplexa resan att beställa ny fiber till ett hus, från första kontakt till aktiv tjänst, demonstrerad i ett webbgränssnitt.

En klickbar första version finns i [`prototype/index.html`](../prototype/index.html). Öppna filen direkt i en webbläsare, ingen byggprocess behövs.

## 1. Mål med prototypen

| Mål | Hur vi visar det |
|---|---|
| Kunden får en preliminär tidsbedömning redan vid första kontakten | Adressen ger direkt ett tidsintervall, en säkerhetsnivå och de faktorer som påverkar |
| En komplex beställning känns enkel | En fråga i taget i chatten, men alltid en samlad bild av beställningen bredvid |
| Inga överraskningar | Pris, datum och nästa steg syns hela tiden och kan ändras före bekräftelse |
| Förtroende för AI:n | Assistenten visar varför den säger något, anger osäkerhet och lämnar över till en människa när det behövs |

Avgränsning: prototypen är en demonstration med fiktiva adresser, priser och tider. Den gör inga riktiga uppslag, kreditkontroller eller bokningar.

## 2. Designprinciper för kundresan

1. **Bedömning först, formulär sen.** Kunden ska få veta "går det, när och vad kostar det" innan vi frågar efter personuppgifter.
2. **En fråga i taget, men hela bilden synlig.** Chatten leder framåt. En fast panel "Din beställning" visar adress, tjänst, datum och kostnader i realtid.
3. **Strukturerade svar i stället för fritext där det går.** Knappar, datumval och kort minskar fel. Fritext finns alltid som komplement.
4. **Ärlig osäkerhet.** Tider visas som intervall med säkerhetsnivå (hög, medel, låg) och med de faktorer som styr. Intervallet smalnar av när mer är känt.
5. **Allt går att ändra före bekräftelse.** Sammanfattningen har "Ändra" på varje del, och kunden behöver inte börja om.
6. **Tre adresser hålls isär tydligt.** Installationsadress (där fibern dras), leveransadress (dit routern skickas) och fakturaadress.
7. **Människa nära till hands.** "Prata med en person" finns alltid, och hela kontexten följer med vid överlämning.
8. **Två statusfärger, inget annat.** Grönt betyder att en aktivitet är klar eller godkänd. Rött betyder att den inte är klar eller inte godkänd. Färgerna kompletteras alltid med en symbol (bock eller kryss) så att de fungerar även för färgblinda. Varumärkesfärgen är blå så att den aldrig kan förväxlas med en status.
9. **Kommunikation efter köp.** Resan slutar inte vid bekräftelse. Kunden följer ordern i en statusvy med proaktiva besked.

## 3. Kundresan steg för steg

### Steg 0. Ingång
Kunden möter assistenten på webben ("Vad vill du göra?"). Snabbval: Skaffa fiber, Byta bredband, Annat.

### Steg 1. Adress och preliminär bedömning (kärnan i demon)
Kunden anger adress. Assistenten slår upp nätstatus och ger direkt:

- **Scenario A, fiber finns och är aktiv:** klart på 5–10 arbetsdagar, hög säkerhet. Router skickas, kunden kopplar in själv.
- **Scenario B, fiber finns i tomtgräns men inte indragen:** 4–8 veckor, medelsäkerhet. Kräver grävning på tomten, håltagning och inkoppling.
- **Scenario C, inget fibernät i området:** 6–12 månader, låg säkerhet. Kräver utbyggnad som beror på hur många grannar som anmäler intresse. Kunden erbjuds intresseanmälan och ett tillfälligt mobilt bredband.

Varje bedömning visar: tidsintervall, tidigaste och senaste datum, säkerhetsnivå och en lista med aktiviteter som behöver vara klara (till exempel "Grävning är inte bokad", "Inkoppling med tekniker bokad").

### Steg 2. Förutsättningar på tomten (endast scenario B)
Vem gräver på tomten? "Vi sköter allt" eller "Jag gräver själv" (lägre pris, men kunden ansvarar för att schaktet är klart till ett visst datum). Valet uppdaterar både pris och tidsbedömning direkt, vilket är ett tydligt demoögonblick.

### Steg 3. Behovsanalys och val av tjänst
Innan produkterna visas gör assistenten en kort behovsanalys med tre frågor, en i taget:

1. Hur många i hushållet använder internet? (1, 2–3, 4–5, 6 eller fler)
2. Vad används internet till? Flerval: surf och mejl, streaming, hemarbete och videomöten, onlinespel, stora filer och uppladdning.
3. Hur viktigt är priset? Lägsta pris, en bra balans eller bästa prestanda.

Svaren ger ett uppskattat behov i Mbit/s när flest är uppkopplade samtidigt. Assistenten rekommenderar den minsta hastighet som räcker. Om priset är viktigast och behovet ligger nära en lägre nivå föreslås den lägre nivån, med besparingen per månad och en tydlig upplysning om nackdelen. Om prestanda är viktigast föreslås ett steg upp. Den rekommenderade produkten markeras tydligt och övriga alternativ visas utgråade, men går fortfarande att välja. Kunden kan hoppa över analysen, och väljer kunden en lägre hastighet än behovet säger assistenten det vänligt utan att stoppa köpet. Tillval (tv, telefoni) kan läggas till.

I prototypen är behovsberäkningen en enkel tumregel. I en riktig lösning bör den kalibreras mot faktisk användningsdata.

### Steg 4. Identifiering och kunduppgifter
Mobilt BankID (mockat) fyller i namn och personnummer. Kontaktuppgifter bekräftas. Kreditkontroll nämns tydligt innan den görs.

### Steg 5. Adresser
- Installationsadress: låst, samma som i steg 1.
- Leveransadress för router: hem, annan adress eller paketombud.
- Fakturaadress: e-post (e-faktura/pdf) eller postadress.

### Steg 6. Leveransdatum och bokning av installation
- Scenario B har två bokningar: grävning och indragning (en vecka) samt inkoppling i huset (förmiddag eller eftermiddag).
- Grävveckan väljs bland föreslagna veckor eller med en datumväljare. Väljer kunden en vecka mellan december och mars visas en varning direkt i datumväljaren: tjäle kan försena grävningen. Kunden kan välja en tidigare vecka eller boka ändå, och tidsbedömningen får då extra marginal.
- Routern levereras automatiskt cirka 5 dagar före inkopplingen så att den inte ligger och väntar i veckor.
- Abonnemanget och månadsavgiften startar först när tjänsten är aktiv.
- Checklista före besöket: någon över 18 år hemma, fri väg till platsen för fiberuttaget, markera ledningar på tomten.

### Steg 7. Betalning och fakturering
- Engångskostnad (anslutning): betala direkt eller delbetala.
- Betalsätt: e-faktura, autogiro, pdf via e-post eller pappersfaktura (med avgift).
- Förklaring av första fakturan: anslutningsavgift plus delmånad från aktiveringsdagen.
- Information om möjligt ROT-avdrag för arbetskostnaden (måste verifieras, se öppna frågor).

### Steg 8. Sammanfattning och bekräftelse
Allt på ett ställe med "Ändra" per del, totalkostnad första året, information om ångerrätt (14 dagar vid distansköp) och godkännande av villkor.

### Steg 9. Efter köpet
Statusvy med milstolpar: Order mottagen, Grävning bokad, Grävning klar, Router skickad, Inkoppling, Aktiv. Proaktiva meddelanden vid förändringar (till exempel ny tid om grävningen försenas) med möjlighet att boka om själv.

## 4. Assistentens roll och beteende

| Område | Riktlinje |
|---|---|
| Ton | Kort, vardaglig svenska. Inga tekniska termer utan förklaring ("nod", "CPE"). |
| Gränssnitt | Hybrid: chatt för dialog, kort och knappar för val, panel för helheten. |
| Rådgivning | Ställ frågor om behov innan produkter visas. Rekommendera det som räcker, inte det dyraste, och förklara varför. |
| Osäkerhet | Ange alltid intervall och säkerhetsnivå. Lova aldrig exakt datum före bokning. |
| Förklarbarhet | "Varför tar det så lång tid?" ska alltid kunna besvaras med de faktiska faktorerna. |
| Gränser | Assistenten ändrar inga priser och ger inga juridiska besked. Den hänvisar till villkor och personal. |
| Överlämning | Vid frustration, upprepade fel eller begäran kopplas en människa in med hela sammanhanget. |

## 5. Modell för preliminär bedömning

**Indata:** adressens nätstatus (aktiv, tomtgräns, inget nät), avstånd från tomtgräns till hus, typ av mark, vem som gräver, säsong (tjäle), grävtillstånd, tillgänglig installationskapacitet i området, eventuellt utbyggnadsprojekt och anslutningsgrad.

**Utdata:** tidsintervall (tidigast, senast), säkerhetsnivå och en lista med faktorer som förklarar intervallet.

**I prototypen:** regelbaserad och mockad. I en riktig lösning: regler kombinerade med historiska leveranstider per område, med intervallet kalibrerat så att till exempel 80 procent av ordrarna landar inom det.

## 6. Webbgränssnittet

```
+-------------------------------------------------+-----------------------------+
|  Assistent (chatt)                              |  Din beställning            |
|                                                 |  Steg: Adress > Tjänst > .. |
|  [Bot] Vilken adress gäller det?                |                             |
|  [Kort: adressförslag]                          |  Preliminär bedömning       |
|  [Kund] Ekbackevägen 4                          |  4–8 veckor  (Medel)        |
|  [Kort: Fiber i tomtgräns, 4–8 veckor, ...]     |  |====|----------| tidslinje |
|                                                 |  Faktorer ...               |
|  [ Skriv här...                ] [Skicka]       |  Kostnader: engång / månad  |
+-------------------------------------------------+-----------------------------+
```

På mobil staplas panelen ovanför chatten som en kompakt, fällbar sammanfattning. En demoverktygsrad gör att presentatören kan börja om eller hoppa direkt till ett scenario.

## 7. Demoscenarier

| Scenario | Adress (fiktiv) | Bedömning | Vad det visar |
|---|---|---|---|
| A | Björkvägen 12, Lerum | 5–10 arbetsdagar, hög | Den snabba, enkla vägen |
| B | Ekbackevägen 4, Alingsås | 4–8 veckor, medel | Hela den komplexa resan med grävning, två bokningar och delbetalning |
| C | Sjöviksvägen 31, Ödeshög | 6–12 månader, låg | Ärlighet när svaret är "inte än", plus ett alternativ |

Rekommenderad demo: kör B från början till slut (cirka 5 minuter), visa sedan A och C som kontrast (1 minut vardera).

## 8. Teknisk plan

**Fas 1, klickbar prototyp (finns nu):** en HTML-fil, vanilla JavaScript, förskriven dialog, mockade data. Syfte: testa flödet med användare och intressenter.

**Fas 2, riktig AI-dialog:** en språkmodell (till exempel Claude via API) med verktygsanrop mot mockade tjänster. Gränssnittets kort och panel behålls, modellen styr dialogen.

| Verktyg | Ansvar |
|---|---|
| `lookup_address(adress)` | Nätstatus, fastighetstyp, avstånd |
| `estimate_installation(adress, val)` | Intervall, säkerhet, faktorer |
| `list_products(adress)` | Tillgängliga tjänster och priser |
| `get_install_slots(adress, typ, från)` | Lediga tider |
| `create_order(order)` | Skapar order, returnerar ordernummer |

Principen är att modellen aldrig hittar på priser eller tider: allt sådant kommer från verktygen och visas i strukturerade kort.

**Fas 3, integration:** koppling mot verkliga system för adressuppslag, order, bokning och fakturering, samt överlämning till kundtjänst.

## 9. Utvärdering

- Användartester med 5–8 personer per runda: kan de förklara när fibern kommer och vad det kostar efter genomgången?
- Mätpunkter: tid till första bedömning, andel som slutför, antal "Ändra"-klick, antal frågor till människa.
- Intressenttest: kundtjänst, fältteknik och fakturering granskar att löftena i flödet går att hålla.

## 10. Tidsplan (förslag)

| Vecka | Aktivitet |
|---|---|
| 1 | Workshop: validera flödet och scenarierna med kundtjänst, leverans och fakturering |
| 2 | Förfina klickbar prototyp, användartest runda 1 |
| 3–4 | Fas 2: LLM-dialog med verktygsanrop mot mockdata |
| 5 | Användartest runda 2, demo för ledning |

## 11. Risker och öppna frågor

| Fråga | Varför den spelar roll |
|---|---|
| Hur träffsäkra är våra historiska leveranstider per område? | Avgör om intervallen går att lita på |
| Vem äger löftet om datum, sälj eller leverans? | Undvik att assistenten lovar något leverans inte kan hålla |
| Gäller ROT-avdrag för grävning och indragning i vårt erbjudande, och hur hanteras det på fakturan? | Påverkar pris och kommunikation, behöver verifieras mot Skatteverkets regler |
| Kreditkontroll: när och hur kommuniceras den? | Juridik och kundförtroende |
| Hur hanteras grävtillstånd och samförläggning med grannar? | Kan förlänga tiden kraftigt |
| Vilka uppgifter får assistenten spara mellan besök? | GDPR och samtycke |

## Antaganden

- Priser, tider och adresser i prototypen är fiktiva och endast till för demonstration.
- Målgruppen är privatkunder i villa. Flerbostadshus och företag är utanför denna prototyp.
- BankID, kreditkontroll och bokning är simulerade.
