console.log('Starting EV Assistant server...');
const express = require('express');
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const { MessagingResponse } = require('twilio').twiml;
const twilio = require('twilio');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const querystring = require('querystring');
require('dotenv').config();

// In-memory session store: phone number => state
const sessions = {};

app.post('/whatsapp', async (req, res) => {
  console.log("Webhook hit from Twilio:", req.headers['user-agent']);
  console.log("Incoming request: POST /whatsapp");
  // Safety log for debugging request body
  if (req.body) {
    console.log("Incoming request body:", req.body);
  } else {
    console.warn("No request body received!");
  }
  const twiml = new MessagingResponse();
  const incomingMsgRaw = req.body.Body || '';
  const incomingMsg = incomingMsgRaw.toLowerCase().trim();
  const from = req.body.From;

  console.log(`Message from ${from}: "${incomingMsgRaw}"`);
  console.log(`Current session: ${sessions[from]}`);

  // Check if user has an active session state
  const session = sessions[from];

  if (session === 'waiting_for_location') {
    // This message is the location after bot asked for it
    const locationQuery = incomingMsgRaw.trim();

    if (!locationQuery) {
      twiml.message("Please enter a valid postcode or city.");
      console.log("Responding with TwiML:", twiml.toString());
      console.log("Final TwiML response sent.");
      res.set('Content-Type', 'text/xml');
      return res.status(200).send(twiml.toString());
    }

    // Clear session as we got location input
    delete sessions[from];

    try {
      const apiKey = process.env.OPENCHARGEMAP_API_KEY;
      const geocodeKey = process.env.OPENCAGE_API_KEY;

      // Get coordinates from location input (city, postcode or combined)
      const geoUrl = `https://api.opencagedata.com/geocode/v1/json?${querystring.stringify({
        q: locationQuery,
        key: geocodeKey,
        limit: 1
      })}`;

      const geoResponse = await fetch(geoUrl);
      const geoData = await geoResponse.json();
      const geometry = geoData.results?.[0]?.geometry;

      if (!geometry) {
        twiml.message("Sorry, I couldn't find that location. Try a different postcode or city.");
        console.log("Responding with TwiML:", twiml.toString());
        console.log("Final TwiML response sent.");
        res.set('Content-Type', 'text/xml');
        return res.status(200).send(twiml.toString());
      }

      const { lat, lng } = geometry;
      console.log(`Geocoded location: ${locationQuery} -> lat: ${lat}, lng: ${lng}`);

      const cx = process.env.GOOGLE_CSE_ID;
      const googleApiKey = process.env.GOOGLE_API_KEY;
      const searchQuery = `EV charging stations near ${locationQuery}`;
      const searchUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(searchQuery)}&cx=${cx}&key=${googleApiKey}`;

      const searchResponse = await fetch(searchUrl);
      const searchData = await searchResponse.json();

      if (Array.isArray(searchData.items) && searchData.items.length > 0) {
        const topResults = searchData.items.slice(0, 3); // limit to top 3 results
        let reply = `🔌 Chargers near *${locationQuery}*:\n\n`;

        topResults.forEach((item, index) => {
          const title = item.title || `Charger ${index + 1}`;
          const snippet = item.snippet || '';
          const displayLink = item.displayLink || '';
          const directionLink = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(title + ' ' + locationQuery)}`;

          reply += `🔌 *${title}*\n📝 ${snippet}\n🔗 ${displayLink}\n➡️ [Get Directions](${directionLink})\n\n`;
        });

        reply += "_Powered by Google_";
        twiml.message(reply);
      } else {
        twiml.message(`No detailed results found via Google, but you can check this map: https://www.google.com/maps/search/EV+chargers+near+${encodeURIComponent(locationQuery)}`);
      }

    } catch (error) {
      console.error("API error:", error);
      twiml.message("Sorry, there was an error fetching charger data.");
    }

    console.log("Responding with TwiML:", twiml.toString());
    console.log("Final TwiML response sent.");
    res.set('Content-Type', 'text/xml');
    return res.status(200).send(twiml.toString());
  }

  // No active session, check user message
  if (incomingMsg.includes('charge')) {
    sessions[from] = 'waiting_for_location';
    console.log(`Session updated: ${from} => waiting_for_location`);
    twiml.message("Sure! Please provide a postcode or city to find nearby chargers.");
    // Debug log after setting session
    console.debug(`Debug: Session for ${from} is now "${sessions[from]}"`);
  } else if (incomingMsg.includes('help')) {
    twiml.message("To find EV chargers, send 'Charge' and I will ask you for a location.");
  } else if (typeof session !== 'undefined') {
    // Fallback response for undefined state
    twiml.message("Oops, something went wrong with your session. Please try again or send 'Charge' to start over.");
    delete sessions[from];
  } else {
    twiml.message("Sorry, I didn't understand that. Try sending 'Charge' for charger info or 'Help' for assistance.");
  }

  console.log("Responding with TwiML:", twiml.toString());
  console.log("Final TwiML response sent.");
  res.set('Content-Type', 'text/xml');
  return res.status(200).send(twiml.toString());
});

app.listen(9000, () => {
  console.log('Server is running on http://localhost:9000');
});