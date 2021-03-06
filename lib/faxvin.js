"use strict";

const puppeteer = require("puppeteer-extra");
const url = require("url");
const qs = require("querystring");

const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const AdblockerPlugin = require("puppeteer-extra-plugin-adblocker");
const RecaptchaPlugin = require("puppeteer-extra-plugin-recaptcha");
const fs = require("fs-extra");
if (process.env.PUPPETEER_ADBLOCKER) puppeteer.use(AdblockerPlugin({ blockTrackers: true }));
puppeteer.use(StealthPlugin());
puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: "2captcha",
      token: process.env.TWOCAPTCHA_TOKEN,
    },
    visualFeedback: true,
  })
);

exports.FaxVin = class FaxVin {
  static async initialize() {
    const args = process.env.PUPPETEER_PROXY ? [ '--proxy-server=' + process.env.PUPPETEER_PROXY ] : [];
    return new this(await puppeteer.launch({ headless: true, args }));
  }
  constructor(browser) {
    this._browser = browser;
  }
  async beforeHook(page, meta) {
    if (process.env.NODE_ENV === "development") {
      console.error(meta);
//      await page.screenshot({ path: "fv-" + meta + ".png" });
    }
  }
  async screenshot(p) {
    const screen = await this._browser.screenshot();
    await fs.writeFile(p, screen);
  }
  async waitForNavigation(page) {
    await page.waitForTimeout(1000);
  }
  async submitRecaptchasAndWait(page) {
    await this.waitForNavigation(page);
    try {
      await page.click('button[type="submit"]');
      await this.waitForNavigation(page);
    } catch (e) {
      console.error(e);
      console.error("pass");
    }
  }
  async solveCaptchas(page) {
    await page.solveRecaptchas();
    await this.beforeHook(page, "after-solve");
  }
  async extractData(page) {
    try {
      const [ vin, make, model, year, trim, style, engine, madeIn, age ] = await page.evaluate(() =>
        ((it) => {
          let value = null;
          const result = [];
          while ((value = it.iterateNext())) {
            result.push(value);
          }
          return result;
        })(document.evaluate("//tbody//td//b", document)).map((v) =>
          v.innerText.trim()
        )
      );
      return {
        vin,
        make,
        model,
        year,
        trim,
        style,
        engine,
        madeIn,
        age,
      };
    } catch (e) {
      if (process.env.NODE_ENV === "development") console.error(e);
      return null;
    }
  }
  async _resultWorkflow(page) {
    await this.beforeHook(page, "load-page");
    await page.waitForNetworkIdle();
    await this.solveCaptchas(page);
    await this.beforeHook(page, "submit-recaptchas");
//    await this.submitRecaptchasAndWait(page);
    await this.waitForNavigation(page);
    await this.beforeHook(page, "extract-data");
    await page.waitForSelector('tbody');
    return await this.extractData(page);
  }
  async openPage(url) {
    const page = await this._browser.newPage();
    await page.goto(url);
    return page;
  }
  async searchPlate(number, state) {
    const page = await this.openPage(
      url.format({
        protocol: "https:",
        hostname: "www.faxvin.com",
        pathname: "/",
      })
    );
    await page.waitForNetworkIdle();
    const site =
      url.format({
        protocol: "https:",
        hostname: "www.faxvin.com",
        pathname: "/license-plate-lookup/result",
      }) +
      "?" +
      qs.stringify({ plate: number, state });
    await page.goto(site);
    return await this._resultWorkflow(page);
  }
  async close() {
    try {
      await this._browser.close();
    } catch (e) {
      console.error(e);
    }
  }
};

exports.lookupPlate = async ({ plate, state }) => {
  const fv = await exports.FaxVin.initialize();
  const result = await fv.searchPlate(plate, state);
  fv.close()
  return result;
};
