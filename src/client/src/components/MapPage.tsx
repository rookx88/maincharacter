// src/client/src/components/MapPage.tsx
import React from 'react';
import CityMap from './CityMap';
import cityMapImage from '../assets/images/city-map.jpg'; // Adjust path as needed

const MapPage: React.FC = () => {
  const handleLocationClick = (location: any) => {
    console.log(`Clicked on: ${location.name} (ID: ${location.id})`);
    // Handle navigation or display information about the location
    // You could navigate to a specific page based on the location ID
  };

  return (
    <div className="map-page">
      <h1>Main Character City Map</h1>
      <p>Click on different locations to explore the city</p>
      
      <CityMap 
        mapImage={cityMapImage} 
        onLocationClick={handleLocationClick} 
      />
    </div>
  );
};

export default MapPage;