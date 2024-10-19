import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import routes from "./routes";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// CORS configuration
const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5500"], // Allow only your frontend origin
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("timeout", 120000);

app.use("/api", routes);

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
