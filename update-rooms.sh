#!/bin/bash

# Get all room IDs from the bonzaiInventory table
room_ids=$(aws dynamodb scan \
  --table-name bonzaiInventory \
  --projection-expression "roomId" \
  --output json | jq -r '.Items[].roomId.S')

# Loop through each roomId and update roomIsAvailable to true
for room_id in $room_ids; do
  aws dynamodb update-item \
    --table-name bonzaiInventory \
    --key "{\"roomId\": {\"S\": \"$room_id\"}}" \
    --update-expression "SET roomIsAvailable = :true" \
    --expression-attribute-values "{\":true\": {\"BOOL\": true}}"
  echo "Updated room $room_id to roomIsAvailable=true"
done

#chmod +x update-rooms.sh
#./update-rooms.sh