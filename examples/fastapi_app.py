import os

from fastapi import FastAPI

from africa_payments_webhooks.adapters.fastapi import webhook_endpoint

app = FastAPI()


async def on_event(event):
    print(event.provider, event.type, event.reference)


app.add_api_route(
    "/webhooks/korapay",
    webhook_endpoint(provider="korapay", secret=os.environ["KORAPAY_SECRET_KEY"], on_event=on_event),
    methods=["POST"],
)
