import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import routes from "./routes";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// CORS configuration
interface CorsOptions {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void;
  credentials: boolean;
  methods: string[];
  allowedHeaders: string[];
}

const corsOptions: CorsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || ["http://localhost:3000", "https://app.aequusplay.com", "https://aequusplay.com"].includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("timeout", 120000);

app.use("/api", routes);
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  console.log("Headers:", req.headers);
  console.log("Body:", req.body);
  next();
});
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error(err.stack);
    res.status(500).send("Something broke!");
  }
);

const server = app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
server.timeout = 120000;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
