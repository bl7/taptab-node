import { io, Socket } from "socket.io-client";
import { useMenuAvailabilityStore } from "../stores/menuAvailabilityStore";

export class AvailabilityWebSocketService {
  private socket: Socket | null = null;
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  connect() {
    this.socket = io("ws://your-domain.com", {
      auth: {
        token: this.token,
      },
    });

    this.socket.on("connect", () => {
      console.log("Connected to WebSocket server");

      // Authenticate the socket
      this.socket?.emit("authenticate", { token: this.token });
    });

    this.socket.on("authenticated", () => {
      console.log("WebSocket authenticated successfully");
    });

    this.socket.on("menuItemAvailabilityUpdate", (data) => {
      if (data.type === "MENU_ITEM_AVAILABILITY_UPDATE") {
        const { itemId, available, itemName } = data.payload;
        const title =
          data.title || `Menu Item ${available ? "Available" : "Out of Stock"}`;

        // Update the availability store
        useMenuAvailabilityStore
          .getState()
          .setItemAvailability(itemId, available);

        // Show notification to staff
        this.showAvailabilityNotification(title, itemName, available);
      }
    });

    this.socket.on("disconnect", () => {
      console.log("Disconnected from WebSocket server");
    });
  }

  private showAvailabilityNotification(
    title: string,
    itemName: string,
    available: boolean
  ) {
    const message = available
      ? `✅ ${itemName} is now available`
      : `❌ ${itemName} is now out of stock`;

    // Use your notification system (toast, alert, etc.)
    console.log(`${title}: ${message}`);

    // Example: Show toast notification with title
    // toast.info(message, { title });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
