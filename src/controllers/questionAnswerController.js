// controllers/questionAnswer.controller.js

import QuestionAnswer from "../models/QuestionAnswer.js";
import slugify from "slugify";

export const createQuestionAnswer = async (req, res) => {
  try {
    const body = req.body;

    const slug = slugify(body.question, {
      lower: true,
      strict: true,
    });

    const qa = await QuestionAnswer.create({
      ...body,
      slug,
    });

    res.status(201).json({
      success: true,
      data: qa,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getAllQuestionAnswers = async (req, res) => {
  try {
    const {
      search,
      category,
      gender,
      ageGroup,
      bodyPart,
      tags,
      page = 1,
      limit = 10,
    } = req.query;

    const filter = {
      isPublished: true,
    };

    if (search) {
      filter.$text = {
        $search: search,
      };
    }

    if (category) {
      filter.category = category;
    }

    if (gender) {
      filter.gender = gender;
    }

    if (ageGroup) {
      filter.ageGroups = ageGroup;
    }

    if (bodyPart) {
      filter.bodyPart = bodyPart;
    }

    if (tags) {
      filter.tags = {
        $in: tags.split(","),
      };
    }

    const data = await QuestionAnswer.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await QuestionAnswer.countDocuments(filter);

    res.json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getSingleQuestionAnswer = async (req, res) => {
  try {
    const qa = await QuestionAnswer.findById(req.params.id);

    if (!qa) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
      });
    }

    qa.views += 1;
    await qa.save();

    res.json({
      success: true,
      data: qa,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateQuestionAnswer = async (req, res) => {
  try {
    const qa = await QuestionAnswer.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
      }
    );

    res.json({
      success: true,
      data: qa,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteQuestionAnswer = async (req, res) => {
  try {
    await QuestionAnswer.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};