require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const fetch = require('node-fetch'); // Ensure node-fetch v2 is installed
const db = require('./db');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 9000;

const sessions = {};
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes timeout

function getSession(phone) {
  if (!sessions[phone]) {
    sessions[phone] = { state: undefined, data: {}, lastActive: Date.now() };
  }
  return sessions[phone];
}

function isSessionExpired(session) {
  if (!session.lastActive) return false;
  return (Date.now() - session.lastActive) > SESSION_TIMEOUT_MS;
}

function registerUserCar(phone, carModel) {
  const stmt = db.prepare(`
    INSERT INTO users (phone, car_model) VALUES (?, ?)
    ON CONFLICT(phone) DO UPDATE SET car_model = excluded.car_model
  `);
  stmt.run(phone, carModel);
}

function getUserCar(phone) {
  const row = db.prepare('SELECT car_model FROM users WHERE phone = ?').get(phone);
  return row ? row.car_model : null;
}

// Fetch chargers from Open Charge Map API
async function fetchChargers(locationOrCoords, carModel) {
  const apiKey = process.env.OPENCHARGEMAP_API_KEY;
  if (!apiKey) return 'API key not configured.';

  // Accept either a location string or coordinates {lat, lon}
  let lat, lon;
  if (typeof locationOrCoords === 'string') {
    // Check if input is in "lat,lon" format
    const coordMatch = locationOrCoords.match(/^([-+]?\d{1,2}(?:\.\d+)?),\s*([-+]?\d{1,3}(?:\.\d+)?)$/);
    if (coordMatch) {
      lat = coordMatch[1];
      lon = coordMatch[2];
    } else {
      try {
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationOrCoords)}&limit=1`);
        const geoData = await geoRes.json();
        if (geoData.length === 0) return `Could not find location "${locationOrCoords}". Please try a valid postcode or city.`;
        lat = geoData[0].lat;
        lon = geoData[0].lon;
      } catch (e) {
        console.error('Geocoding error:', e);
        return 'Error resolving location.';
      }
    }
  } else if (locationOrCoords.lat && locationOrCoords.lon) {
    lat = locationOrCoords.lat;
    lon = locationOrCoords.lon;
  } else {
    return 'Invalid location data.';
  }

  try {
    const chargersRes = await fetch(`https://api.openchargemap.io/v3/poi/?output=json&countrycode=GB&latitude=${lat}&longitude=${lon}&maxresults=5&key=${apiKey}`);
    if (!chargersRes.ok) {
      const errorText = await chargersRes.text();
      console.error("Bad response from API:", chargersRes.status, errorText);
      return 'The charger service is unavailable right now.';
    }
    const chargers = await chargersRes.json();

    // Compose a generic location string for message
    // (no variable named location is defined in this scope)
    if (!chargers.length) return `No chargers found near that location.`;

    // Format chargers info
    let message = `🔌 Chargers near your location:\n\n`;

    chargers.forEach((charger, i) => {
      // Filter out chargers with zero connections
      if (!charger.Connections || charger.Connections.length === 0) return;

      // Compose charger types
      const types = charger.Connections.map(c => c.ConnectionType ? c.ConnectionType.Title : 'Unknown').filter(Boolean);
      const uniqueTypes = [...new Set(types)];

      // Status
      const status = charger.StatusType ? charger.StatusType.Title : 'Unknown';

      // Address for maps link
      const address = charger.AddressInfo ? charger.AddressInfo.Title || charger.AddressInfo.AddressLine1 || '' : '';
      const latC = charger.AddressInfo ? charger.AddressInfo.Latitude : '';
      const lonC = charger.AddressInfo ? charger.AddressInfo.Longitude : '';

      // Map link (lat/lon)
      const mapLink = `https://www.google.com/maps/search/?api=1&query=${latC},${lonC}`;

      message += `📍 ${address}\n⏰ Status: ${status}\n⚡ Chargers: ${charger.NumberOfPoints || charger.Connections.length} (${uniqueTypes.join(', ')})\n➡️ Directions: ${mapLink}\n\n`;
    });

    return message.trim();

  } catch (e) {
    console.error('API error:', e);
    return 'Error fetching charger data.';
  }
}
    // Verification endpoint for WhatsApp webhook setup (GET request)
    app.get('/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
  
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  
    if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified!');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

app.post('/whatsapp', async (req, res) => {


  console.log('Incoming WhatsApp request:', req.body);
  const from = req.body.From;
  const messageBody = req.body.Body ? req.body.Body.trim().toLowerCase() : '';

  const twiml = new MessagingResponse();
  if (!messageBody) {
    twiml.message('Received your message but it was empty.');
    return res.end(twiml.toString());
  }

  const session = getSession(from);
  // Check for timeout and reset if needed
  if (isSessionExpired(session)) {
    session.state = undefined;
    session.data = {};
    console.log(`Session for ${from} expired and reset.`);
  }
  // Update last active timestamp
  session.lastActive = Date.now();

  // Test code block for OpenChargeMap API
  /*
  if (messageBody === 'test') {
    const dummyLat = 53.4808;  // Manchester
    const dummyLon = -2.2426;

    const apiKey = process.env.OPENCHARGEMAP_API_KEY;
    console.log('Using API key:', apiKey);

    try {
      const chargersRes = await fetch(`https://api.openchargemap.io/v3/poi/?output=json&countrycode=GB&latitude=${dummyLat}&longitude=${dummyLon}&maxresults=3&key=${apiKey}`);
      if (!chargersRes.ok) {
        const errorText = await chargersRes.text();
        console.error("Bad response from API:", chargersRes.status, errorText);
        twiml.message('OpenChargeMap API error.');
        return res.end(twiml.toString());
      } else {
        const chargers = await chargersRes.json();
        if (!chargers.length) {
          twiml.message('No chargers found near Manchester.');
          return res.end(twiml.toString());
        } else {
          let message = '🔌 Chargers near Manchester:\n\n';
          chargers.forEach((charger, i) => {
            const name = charger.AddressInfo?.Title || 'Unnamed';
            const lat = charger.AddressInfo?.Latitude;
            const lon = charger.AddressInfo?.Longitude;
            const types = charger.Connections?.map(c => c.ConnectionType?.Title || 'Unknown') || [];
            const uniqueTypes = [...new Set(types)];
            const link = lat && lon ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : '';
            message += `📍 ${name}\n⚡ Types: ${uniqueTypes.join(', ')}\n➡️ ${link}\n\n`;
          });
          twiml.message(message.trim());
          return res.end(twiml.toString());
        }
      }
    } catch (err) {
      console.error('API error:', err);
      twiml.message('Something went wrong while fetching chargers.');
      return res.end(twiml.toString());
    }
  }
  */

  // Main flow logic
  if (messageBody === 'charge') {
    session.state = 'waiting_for_location';
    twiml.message('Sure! Please share your location from WhatsApp location feature or provide a postcode or city to find nearby chargers.');
    return res.end(twiml.toString());
  } else if (session.state === 'waiting_for_location') {
    const carModel = getUserCar(from);
    const chargerResponse = await fetchChargers(messageBody, carModel);
    twiml.message(chargerResponse);
    session.state = null;

    // Send follow-up message about personalization
    const followUp = new MessagingResponse();
    followUp.message('Want more personalized results based on your vehicle? Reply with `register` to save your car model.');
    return res.end(twiml.toString() + followUp.toString());
  } else if (messageBody === 'register') {
    session.state = 'waiting_for_car_model';
    twiml.message('Great! Please reply with your car make and model (e.g., Nissan Ariya).');
    return res.end(twiml.toString());
  } else if (session.state === 'waiting_for_car_model') {
    registerUserCar(from, req.body.Body.trim());
    twiml.message(`Thanks! We've saved your vehicle details for future personalized results.`);
    session.state = null;
    return res.end(twiml.toString());
  } else if (messageBody === 'cost') {
    session.state = 'awaiting_distance';
    session.data = {};
    twiml.message("Great! Let's calculate your trip cost.\nFirst, how many miles is your trip?");
    return res.end(twiml.toString());
  } else if (session.state === 'awaiting_distance') {
    const distance = parseFloat(messageBody);
    if (isNaN(distance)) {
      twiml.message("That doesn't look like a number. Please enter the trip distance in kilometers (e.g., 120).");
      return res.end(twiml.toString());
    } else {
      session.data.distanceKm = distance;
      session.state = 'awaiting_price';
      twiml.message("Thanks! Now, what's your electricity cost per kWh in pounds? (e.g., 0.34)");
      return res.end(twiml.toString());
    }
  } else if (session.state === 'awaiting_price') {
    const price = parseFloat(messageBody);
    if (isNaN(price)) {
      twiml.message("Hmm, that doesn't look right. Please enter the cost per kWh in pounds (e.g., 0.34).");
      return res.end(twiml.toString());
    } else {
      session.data.pricePerKWh = price;
      session.state = 'awaiting_consumption';
      twiml.message("Got it. Lastly, what's your vehicle's energy consumption per 100 km? (e.g., 18)\nReply “Not sure” and I’ll use an average value of 18 kWh/100 km.");
      return res.end(twiml.toString());
    }
  } else if (session.state === 'awaiting_consumption') {
    const consumptionInput = req.body.Body.trim().toLowerCase();

    if (consumptionInput === 'not sure') {
      session.data.consumption = 18; // default average
      const { distanceKm, pricePerKWh } = session.data;
      const distanceKmConverted = distanceKm * 1.60934;
      const energyNeeded = (distanceKmConverted / 100) * session.data.consumption;
      const estimatedCost = energyNeeded * pricePerKWh;

      twiml.message(`🔋 Estimated trip cost:\n\n• Distance: ${distanceKmConverted.toFixed(2)} km (${(distanceKmConverted / 1.60934).toFixed(2)} miles)\n• Energy needed: ${energyNeeded.toFixed(2)} kWh\n• Estimated cost: £${estimatedCost.toFixed(2)}\n\nIf you'd like to provide a more accurate consumption later, just let me know!`);
      session.state = null;
      session.data = {};
      return res.end(twiml.toString());
    } else {
      const consumption = parseFloat(consumptionInput);
      if (isNaN(consumption)) {
        twiml.message("That doesn't seem right. Please enter the consumption in kWh per 100 km (e.g., 18), or reply 'Not sure' to use the average value.");
        return res.end(twiml.toString());
      } else {
        session.data.consumption = consumption;
        const { distanceKm, pricePerKWh } = session.data;
        const distanceKmConverted = distanceKm * 1.60934;
        const energyNeeded = (distanceKmConverted / 100) * consumption;
        const estimatedCost = energyNeeded * pricePerKWh;

        twiml.message(`🔋 Estimated trip cost:\n\n• Distance: ${distanceKmConverted.toFixed(2)} km (${(distanceKmConverted / 1.60934).toFixed(2)} miles)\n• Energy needed: ${energyNeeded.toFixed(2)} kWh\n• Estimated cost: £${estimatedCost.toFixed(2)}`);
        session.state = null;
        session.data = {};
        return res.end(twiml.toString());
      }
    }
  }
  // New menu option
  if (messageBody === 'menu') {
    twiml.message(`EV Assistant Menu:

1️⃣ Type *charge* to find EV chargers near you
2️⃣ Type *cost* to estimate your trip cost

You can also type *register* to personalize your experience.`);
    return res.end(twiml.toString());
  }
  else if (!session.state && !session.welcomed && messageBody !== 'menu') {
    session.welcomed = true;
    twiml.message(`👋 Welcome to EV Assistant!

Type *menu* to get started and explore available features.`);
    return res.end(twiml.toString());
  }
  else {
    twiml.message("Sorry, I didn't understand that. Please type *menu* to see available options.");
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});


// Cost estimation endpoint
app.post('/cost', async (req, res) => {
  const { distanceKm, pricePerKWh, consumptionKWhPer100Km } = req.body;

  if (!distanceKm || !pricePerKWh || !consumptionKWhPer100Km) {
    return res.status(400).json({ error: 'Missing parameters.' });
  }

  const distanceKmConverted = distanceKm * 1.60934;
  const energyNeeded = (distanceKmConverted / 100) * consumptionKWhPer100Km;
  const estimatedCost = energyNeeded * pricePerKWh;

  return res.json({
    distanceMiles: distanceKm,
    distanceKm: distanceKmConverted,
    pricePerKWh,
    consumptionKWhPer100Km,
    energyNeededKWh: energyNeeded,
    estimatedCost: estimatedCost.toFixed(2)
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});