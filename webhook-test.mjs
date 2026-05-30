const payload = {
  service: "aws-docker-build",
  status: "failure",
  description: "Error 137: Container ran out of memory during yarn build"
};

console.log("Pinging Fluxion Core Webhook...");

const res = await fetch("http://localhost:3002/api/webhooks/cicd", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

const data = await res.json();
console.log("Response Status:", res.status);
console.log("Ingestion Payload:", JSON.stringify(data, null, 2));
