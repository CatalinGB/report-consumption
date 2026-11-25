# Ghid complet — sistemul de citire a contoarelor

Acest document explică sistemul așa cum îl vede un utilizator final. Este textul
afișat la finalul dashboard-ului `kalio-contoare/contoare`; exemplul folosește
nume generice (`House A`, `electricity-a`). Valorile reale trăiesc doar în
Home Assistant, MQTT și configurația privată.

## 1. Pe scurt

Sistemul are două persoane și un flux lunar:

- **Index submitter** citește contorul și trimite indexul din pagina de raportare.
- **Company submitter** verifică, aprobă sau suprimă trimiterea către companie.
- **MQTT** este locul unde stau datele: configurația, indexurile, pozele și
  statusurile. Aplicația nu are backend și nu citește Home Assistant.
- **Home Assistant** trimite notificările, ține minte cine este responsabil și
  vorbește cu integrările companiilor.

## 2. Rolurile

| Rol | Cine | Ce face | Cum este notificat |
|---|---|---|---|
| **Index submitter** | Persoana care citește contoarele | Deschide pagina de raportare, introduce indexul, poate atașa o poză | **ntfy**, mesaj generic: „Raportează index electricitate/gaz/apă”. Fără nume de casă, index, perioadă sau adresă. |
| **Company submitter** | Persoana care administrează | Verifică propunerile, aprobă/suprimă, schimbă ferestrele și pragurile | **Pushover** pe telefonul adminului, cu detaliu operațional (contor, index, perioadă, status). Fără adresă. |

## 3. Ciclul unei luni

1. **Fereastra se deschide.** Fiecare contor are o fereastră lunară (ex. 22–26).
   Înăuntrul ei, compania acceptă auto-citirea.
2. **Index submitter raportează.** Pagina verifică dacă indexul este numeric,
   dacă nu este sub ultimul index și dacă se încadrează în intervalul normal.
   Un index neobișnuit cere confirmare; unul refuzat este blocat.
3. **Apare propunerea.** HA scrie un status `proposed` pentru perioadă. Nu
   trimite încă nimic la companie.
4. **Company submitter verifică.** Aprobă (trimite la companie) sau suprimă
   (oprește trimiterea pentru perioadă).
5. **Compania confirmă.** Statusul devine `accepted` (confirmat) sau `forwarded`
   (trimis, dar neconfirmat încă). Dacă ceva eșuează, apare `error` sau `blocked`.
6. **Notificările se opresc.** Imediat ce există o trimitere sau un status pozitiv
   pentru perioadă, contorul este considerat raportat.

## 3.1 Snapshot automat (dacă este configurat)

Pentru un contor cu sursă smart, HA poate publica automat indexul în ziua de 22
(la 00:00, 06:00 și 12:00). Verifică propunerea înainte de aprobare. Dacă
statusul companiei este pentru o perioadă mai nouă decât ultima trimitere din
aplicație, aplicația poate fi în urmă: verifică portalul și istoricul, nu raporta
din nou fără să confirmi.

## 4. Stările pe care le vezi

| Stare | Ce înseamnă | Ce faci |
|---|---|---|
| 🟡 `proposed` | Există o propunere, așteaptă decizia ta | Ține apăsat **Aprobă** sau **Suprimă** |
| ⏳ `sending` | Trimiterea către companie este în curs | Așteaptă; nu repeta |
| 📤 `forwarded` | Butonul a fost apăsat, compania nu a confirmat încă | Verifică portalul companiei |
| ✅ `accepted` | Compania a confirmat indexul | Nimic; perioada este închisă |
| ⏸️ `suppressed` | Ai oprit intenționat trimiterea | **Redeschide** doar dacă trebuie trimisă |
| ⛔ `blocked` | Poarta globală este oprită sau citirea nu este permisă | Verifică **Publicare companie** și citirea permisă |
| ❌ `error` | Trimiterea a eșuat sau datele nu sunt clare | Verifică portalul; nu retrimite automat |
| 🔄 `reopened` | Perioada a fost redeschisă | Este nevoie de o citire nouă |
| — | Fără status | Contorul nu are propunere (ex. apă fără flux de companie) |

## 5. Butoanele

- **Publicare companie** — comutatorul global. Când este oprit, citirile,
  reminderele și propunerile funcționează, dar aprobarea este blocată. Revine
  oprit după restart.
- **Aprobă** — apăsare lungă. Trimite indexul propus la companie: setează
  numărul, apasă butonul integrării sau trimite e-mailul, apoi așteaptă
  confirmarea.
- **Suprimă** — apăsare lungă. Oprește trimiterea pentru perioadă; decizia este
  durabilă.
- **Redeschide** — doar pentru o perioadă suprimată sau blocată. Nu retrimite
  singur; este nevoie de o propunere nouă și de o aprobare nouă.
- **Deschide pagina de raportare** — pagina index submitterului.
- **Administrare** — consola company submitterului: case, contoare, ferestre,
  praguri, istoric, poze.
- **Energy Insights** — graficele și calibrarea contorului smart.

## 6. Notificări

- **Index submitter:** ntfy, mesaj scurt și generic. Doar tipul utilității poate
  varia. Nu conține nume de casă, contor, index, perioadă, adresă, token sau ID
  de instalație.
- **Company submitter:** Pushover pe telefonul adminului, cu detaliu operațional.
  Niciodată o adresă fizică sau de contract.
- **Reminder zilnic:** o dată pe zi, la 10:00, doar pentru contoarele cu fereastra
  deschisă și fără trimitere/status pozitiv.
- **Alertă de închidere:** la 10:05, doar dacă fereastra s-a închis în ultimele
  24 h și contorul este nereportat.
- **Fără watchdog duplicat:** nu există un al doilea reminder la 13:00/20:00. Un
  singur reminder per contor per zi.
- **Oprire:** dacă ai raportat indexul sau compania are deja un status pozitiv
  pentru perioadă, nu se mai trimite nimic.

## 7. Reguli de aur

- **Nu raporta de două ori** același contor în aceeași perioadă. Dacă ai greșit,
  folosește o corecție; ultima valoare câștigă.
- **O corecție după acceptare nu se trimite automat.** Dacă statusul companiei
  este încă `accepted` pentru perioada veche, verifică indexul și redeschide
  perioada înainte de o trimitere nouă.
- **Nu aproba un index refuzat.** Un refuz nu devine niciodată bază pentru luna
  următoare.
- **Nu porni publicarea companie** doar ca să „vezi dacă merge”. Fiecare aprobare
  trimite date reale.
- **Verifică neconcordanța de index provider.** Dacă indexul din integrarea
  companiei diferă de indexul raportat, nu apăsa din nou; verifică portalul.
- **Un index sub ultimul index** este reset de contor, nu consum negativ. Cere
  confirmare.
- **Adresa nu apare nicăieri** în MQTT, aplicație, notificări sau dashboard. Ea
  există doar în configurația privată a serviciului de e-mail, când este
  absolut necesară.

## 8. Dacă ceva nu merge

| Simptom | Cauză probabilă | Ce faci |
|---|---|---|
| Nu vine notificarea | Telefonul nu este abonat la ntfy / Pushover | Verifică abonamentul; reminderul nu se retrimite automat |
| Am raportat, dar apare nereportat | Ultima trimitere din aplicație este veche; statusul companiei poate fi mai nou | Verifică rândul **Companie** și istoricul; nu raporta orbește |
| Corecția nu apare la companie | Statusul companiei este încă `accepted` pentru perioada veche | Verifică indexul, redeschide perioada dacă este nevoie; nu raporta din nou |
| Aprobarea e blocată | **Publicare companie** este oprită sau citirea companiei nu este permisă | Pornește comutatorul și verifică citirea permisă |
| Indexul provider diferă | Integrarea companiei nu a preluat valoarea | Verifică portalul; nu retrimite automat |
| Bridge offline | Mosquitto/Flespi nu mai primește date | Verifică bridge-ul; notificările pot fi întârziate |
| Fereastra este închisă | Ai ieșit din interval | O trimitere întârziată este acceptată și marcată `late`, dar verifică dacă mai este utilă |

## 9. Glosar

- **Index** — numărul de pe contor.
- **Perioadă** — luna căreia îi aparține citirea; este luna în care s-a deschis
  fereastra.
- **Fereastră** — intervalul în care compania acceptă auto-citirea.
- **Propunere** — indexul raportat, pregătit pentru aprobare.
- **Corecție** — o trimitere nouă pentru aceeași perioadă; o înlocuiește pe cea
  veche.
- **Reset** — contorul a fost schimbat sau a coborât sub ultimul index; cere
  confirmare.
- **Range** — intervalul normal calculat din consumul tipic; warning-ul cere
  confirmare, refuzul blochează.
- **Bridge** — legătura dintre brokerul local (acasă) și brokerul MQTT public.

## 10. Confidențialitate

- MQTT și aplicația nu conțin adresa fizică sau de contract.
- ntfy nu conține nume de casă/contor, index, perioadă, adresă, token sau ID de
  instalație.
- Pushover este canalul adminului și poate conține detaliu operațional, dar
  niciodată o adresă.
- Linkurile din notificări sunt URL-uri simple, fără query string, fragment sau
  token.
- Tokenurile stau doar în `localStorage`/`sessionStorage` și în fișierele
  private; nu apar în dashboard, MQTT sau notificări.

---

**Pe scurt:** dacă rândul **Raportat** spune ✅ și **Companie** spune ✅
`accepted`, contorul este închis pentru perioada respectivă. Dacă nu, urmează
instrucțiunea din **Acțiune** și nu inventa o trimitere nouă.
