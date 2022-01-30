const express = require("express");
const ejs = require("ejs");
const { google } = require("googleapis");
const cookieParser = require("cookie-parser")
const bodyParser = require('body-parser');
const Recaptcha = require('express-recaptcha').RecaptchaV2

const app = express();

const varmistus = (req, res, next) => {
  if(req.cookies["kylapaikka"]) {
    next()
  } else {
    res.redirect("/ilmoittaudu");
  }
}

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname + '/views/css'));
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

var recaptcha = new Recaptcha('', '', {"hl": "fi"});

app.use(cookieParser())

app.get("/", varmistus, async (req, res) => {
  var keksi = await req.cookies['kylapaikka'];
  const paikat = await kylatutka("Paikat")
  const paikka = await paikkatiedot(paikat, keksi, false);
  if (paikka == false) {
    res.clearCookie("kylapaikka");
    res.render("index.ejs", {data: {kylapaikka: "Virhe" }});
  }

  res.render("index.ejs", {data: {kylapaikka: paikka}});
});

app.get("/ilmoittaudu", recaptcha.middleware.render, (req, res) => {
  if(!req.cookies["kylapaikka"]) {
    res.render('kirjaudu.ejs', { captcha:res.recaptcha })
  } else {
    res.redirect("/");
  }
})

app.get("/tarkasta", recaptcha.middleware.render, (req, res) => {
  if(!req.cookies["kylapaikka"]) {
    res.render('tarkasta.ejs', { captcha:res.recaptcha })
  } else {
    res.redirect("/");
  }
})

app.post("/ilmoittaudu", recaptcha.middleware.verify, async (req, res) => {
  if (!req.recaptcha.error) {
    var { nimi, puh, sahkoposti } = req.body;
    
    if (nimi || puh || sahkoposti == undefined) {
      
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: "credentials.json",
      scopes: "https://www.googleapis.com/auth/spreadsheets",
    });

    // Create client instance for auth
    const client = await auth.getClient();

    // Instance of Google Sheets API
    const googleSheets = google.sheets({ version: "v4", auth: client });

    const spreadsheetId = "";

    // Read rows from spreadsheet
    const paikat = await googleSheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range: `Paikat!A2:C`,
    });

    const ilmottautuneet = await kylatutka("Ilmottautuneet")
    const kylaPaikkaTarkistus = await paikkatiedot(ilmottautuneet, sahkoposti, true);
    if (kylaPaikkaTarkistus) {
      res.cookie("kylapaikka", kylaPaikkaTarkistus, { maxAge: 1000 * 60 * 60 * 24 * 14, httpOnly: true });
      res.redirect("/");
    } else {
      var {kylaPaikka, rivi, vapaat} = await kylavalitsin(paikat.data.values);

      // Write row(s) to spreadsheet
      await googleSheets.spreadsheets.values.append({
        auth,
        spreadsheetId,
        range: `${kylaPaikka}!A2:C`,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [[nimi, puh, sahkoposti]],
        },
      });

      await googleSheets.spreadsheets.values.append({
        auth,
        spreadsheetId,
        range: "Ilmottautuneet!A2:B",
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [[nimi, sahkoposti, kylaPaikka]],
        },
      });

      await googleSheets.spreadsheets.values.update({
        auth,
        spreadsheetId,
        range: `Paikat!B${rivi}:B${rivi}`,
        valueInputOption: "USER_ENTERED",
        resource: { values: [[vapaat]] },
      });

      res.cookie("kylapaikka", kylaPaikka, { maxAge: 1000 * 60 * 60 * 24 * 14, httpOnly: true });
      res.redirect(302, "/ilmoittaudu");
      
    } 
  } else {
    res.redirect("/ilmoittaudu");
  }
});

app.post("/tarkasta", recaptcha.middleware.verify, async (req, res) => {
  if (!req.recaptcha.error) {
    var { sahkoposti } = req.body;
    
    if (sahkoposti == undefined) {
      res.redirect("/tarkasta")
    }

    const paikat = await kylatutka("Ilmottautuneet")

    const kylaPaikka = await paikkatiedot(paikat, sahkoposti, true);
    if (kylaPaikka == false) {
      res.redirect("/ilmoittaudu");
    } else {
    res.cookie("kylapaikka", kylaPaikka, { maxAge: 1000 * 60 * 60 * 24 * 14});
    res.redirect(302, "/"); }
  } else {
    res.redirect("/tarkasta")
  }
});

//////////////////////////////////////////////
///////////Funktiot///////////////////////////
//////////////////////////////////////////////

function kylavalitsin(tieto) {
  var numero = Math.floor(Math.random() * (tieto.length))
  if (tieto[numero][1] > 0 || tieto[0][4] <= 0) {
    let kylaPaikka = tieto[numero][0];
    let vapaat = tieto[numero][1] - 1;
    let rivi = numero + 2;
    return {kylaPaikka, rivi, vapaat}
  } else {
    kylavalitsin(tieto)
  }
}

async function kylatutka(tila) {

  const auth = new google.auth.GoogleAuth({
    keyFile: "credentials.json",
    scopes: "https://www.googleapis.com/auth/spreadsheets",
  });

  // Create client instance for auth
  const client = await auth.getClient();

  // Instance of Google Sheets API
  const googleSheets = google.sheets({ version: "v4", auth: client });

  const spreadsheetId = "";

  // Read rows from spreadsheet
  const paikat = await googleSheets.spreadsheets.values.get({
    auth,
    spreadsheetId,
    range: `${tila}!A2:D`,
  });
  return paikat.data.values;
}

function paikkatiedot(tieto, avain, sposti) {
  var arvo = 0
  if (sposti){
    arvo = 1;
  }
  if (!tieto) {
    return false
  }
  for (var i = 0; i <= tieto.length - 1; i++) {
    if (tieto[i][arvo] == avain) {
      if (!sposti) {
        return tieto[i][3]
      }
      return tieto[i][2]
    }
  }
  return false
}

app.listen(1333, (req, res) => console.log("Kaynnissa. Portti: 1333"));