const apiUrl = 'http://localhost:5000/api/chargers'; // This is your proxy server endpoint

fetch(apiUrl)
  .then(response => {
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    return response.json();
  })
  .then(data => {
    console.log(data);  // Log the data to inspect it
    displayChargerData(data);  // Call function to display charger data
  })
  .catch(error => {
    console.error('There was a problem with the fetch operation:', error);
  });