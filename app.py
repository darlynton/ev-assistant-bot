from dotenv import load_dotenv
import os
import requests
from flask import Flask, request, jsonify

load_dotenv()  # This loads the environment variables from the .env file
api_key = os.getenv("OPENCHARGEMAP_API_KEY")

app = Flask(__name__)

@app.route('/message', methods=['POST'])
def message():
    incoming_msg = request.values.get('Body', '').lower()
    sender = request.values.get('From')

    if "charger" in incoming_msg:
        response = find_chargers()
    else:
        response = "Sorry, I didn't understand that. Try saying 'charger'."

    return jsonify({"response": response})

def find_chargers():
    lat = 51.5074  # London (static location for now)
    lon = -0.1278
    url = "https://api.openchargemap.io/v3/poi/"
    params = {
        "output": "json",
        "latitude": lat,
        "longitude": lon,
        "distance": 5,
        "distanceunit": "KM",
        "maxresults": 3
    }
    headers = {
        "X-API-Key": api_key
    }

    try:
        res = requests.get(url, params=params, headers=headers)
        res.raise_for_status()
        data = res.json()

        # Debugging: print the raw response
        print("🔎 RAW API RESPONSE:", data)

        if not data:
            return "No nearby chargers found."

        reply = "Nearby chargers:\n"
        for charger in data:
            # Log charger data for debugging
            print("Charger Data:", charger)

            # Safely access the address info
            address_info = charger.get("AddressInfo", None)

            if not address_info:
                print("⚠️ AddressInfo is missing, skipping charger.")
                continue

            # Extract charger details with fallbacks
            name = address_info.get("Title", "Unknown")
            address = address_info.get("AddressLine1", "No address")
            town = address_info.get("Town", "No town")
            postcode = address_info.get("Postcode", "No postcode")
            status = charger.get("StatusType", {}).get("Title", "Status Unknown")

            # Handle missing connections safely
            connections = charger.get("Connections", [])
            if not connections:
                connection_info = "No connections available"
            else:
                connection_info = ", ".join([conn.get("ConnectionType", {}).get("Title", "Unknown") for conn in connections])

            # Build the reply message
            reply += f"- {name}, {address}, {town}, {postcode} ({status})\nConnections: {connection_info}\n"

        return reply.strip()

    except Exception as e:
        return f"Error fetching chargers: {str(e)}"

if __name__ == '__main__':
    app.run(debug=True)