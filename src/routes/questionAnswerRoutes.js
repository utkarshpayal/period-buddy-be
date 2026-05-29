// routes/questionAnswer.routes.js

import express from "express";

import {
  createQuestionAnswer,
  getAllQuestionAnswers,
  getSingleQuestionAnswer,
  updateQuestionAnswer,
  deleteQuestionAnswer,
} from "../controllers/questionAnswerController.js";

const router = express.Router();

router.post("/", createQuestionAnswer);

router.get("/", getAllQuestionAnswers);

router.get("/:id", getSingleQuestionAnswer);

router.put("/:id", updateQuestionAnswer);

router.delete("/:id", deleteQuestionAnswer);

export default router;