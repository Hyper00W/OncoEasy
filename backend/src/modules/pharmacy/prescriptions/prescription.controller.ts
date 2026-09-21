import type { RequestHandler } from "express";

import {
  createPatientPrescription,
  getPatientPrescription,
  getPrescriptionForReview,
  listPatientPrescriptions,
  listPrescriptionReviewQueue,
  queryPrescription,
  rejectPrescription,
  verifyPrescription
} from "./prescription.service";
import type {
  PrescriptionListQuery,
  PrescriptionUploadBody
} from "./prescription.schemas";

export const uploadPrescription: RequestHandler = async (request, response, next) => {
  try {
    const prescription = await createPatientPrescription(
      request.user?.userId as string,
      request.file,
      (request.body as PrescriptionUploadBody).notes
    );
    response.status(201).json({ success: true, data: prescription });
  } catch (error) {
    next(error);
  }
};

export const listPrescriptions: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await listPatientPrescriptions(
        request.user?.userId as string,
        request.query as unknown as PrescriptionListQuery
      )
    });
  } catch (error) {
    next(error);
  }
};

export const getPrescription: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await getPatientPrescription(
        request.user?.userId as string,
        request.params.prescriptionId as string
      )
    });
  } catch (error) {
    next(error);
  }
};

export const listReviewQueue: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await listPrescriptionReviewQueue(
        request.query as unknown as PrescriptionListQuery
      )
    });
  } catch (error) {
    next(error);
  }
};

export const getReviewPrescription: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await getPrescriptionForReview(request.params.prescriptionId as string)
    });
  } catch (error) {
    next(error);
  }
};

export const verifyReviewPrescription: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await verifyPrescription(
        request.params.prescriptionId as string,
        request.user?.userId as string
      )
    });
  } catch (error) {
    next(error);
  }
};

export const rejectReviewPrescription: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await rejectPrescription(
        request.params.prescriptionId as string,
        request.user?.userId as string,
        request.body.reason as string
      )
    });
  } catch (error) {
    next(error);
  }
};

export const queryReviewPrescription: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await queryPrescription(
        request.params.prescriptionId as string,
        request.user?.userId as string,
        request.body.reason as string
      )
    });
  } catch (error) {
    next(error);
  }
};