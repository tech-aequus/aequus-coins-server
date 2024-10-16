import express from "express";
import dotenv from "dotenv";
import routes from "./routes";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

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

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
