const express = require('express')
const router = express.Router()
const { check, validationResult } = require('express-validator')
const request = require('superagent')
const { ip2geo } = require('@origin/ip2geo')

const { asyncMiddleware } = require('../utils')
const { ensureLoggedIn } = require('../lib/login')
const {
  isEthereumAddress,
  isExistingAddress,
  isExistingNickname
} = require('../validators')
const { Account } = require('../models')
const logger = require('../logger')

/**
 * Return users accounts.  */
router.get(
  '/accounts',
  ensureLoggedIn,
  asyncMiddleware(async (req, res) => {
    const accounts = await Account.findAll({
      where: { userId: req.user.id }
    })
    res.json(accounts.map(a => a.get({ plain: true })))
  })
)

/**
 * Add an account.
 */
router.post(
  '/accounts',
  [
    check('nickname')
      .isString()
      .custom(isExistingNickname),
    check('address')
      .custom(isEthereumAddress)
      .custom(isExistingAddress),
    ensureLoggedIn
  ],
  asyncMiddleware(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res
        .status(422)
        .json({ errors: errors.array({ onlyFirstError: true }) })
    }

    const account = await Account.create({
      userId: req.user.id,
      nickname: req.body.nickname,
      address: req.body.address
    })

    logger.info(
      `User ${req.user.email} added account ${account.nickname} with address ${account.address}`
    )

    if (!req.user.employee) {
      // Add account address to Wallet Insights. Only logs a warning on failure,
      // doesn't block the account add action.
      const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for']
      let countryCode = ''
      try {
        const geo = await ip2geo(ip)
        if (geo) {
          countryCode = geo.countryCode
        }
      } catch (e) {
        logger.warn(
          `Failed resolving IP ${ip} to a country for sending to Insight`
        )
      }
      request
        .post('https://www.originprotocol.com/mailing-list/join')
        .send(`email=${encodeURIComponent(req.user.email)}`)
        .send(`investor=1`)
        .send(`eth_address=${req.body.address}`)
        .send(`name=${encodeURIComponent(req.user.name || req.user.email)}`)
        .send(`ip_addr=${ip || ''}`)
        .send(`country_code=${countryCode || ''}`)
        .then(
          response => {
            if (response.body.success) {
              logger.info(
                `Added ${req.body.address} to wallet insights for ${req.user.email}`
              )
            } else {
              logger.warn(
                `Could not add ${req.body.address} to wallet insights for ${req.user.email}: ${response.body.message}`
              )
            }
          },
          error => {
            logger.warn(
              `Could not add ${req.body.address} to wallet insights for ${req.user.email}: ${error.response.body}`
            )
          }
        )
    }

    res.status(201).json(account.get({ plain: true }))
  })
)

/**
 * Delete an account
 */
router.delete(
  '/accounts/:accountId',
  ensureLoggedIn,
  asyncMiddleware(async (req, res) => {
    const account = await Account.findOne({
      where: { id: req.params.accountId, userId: req.user.id }
    })
    if (!account) {
      res.status(404).end()
    } else {
      logger.info(
        `User ${req.user.email} removed account ${account.nickname} with address ${account.address}`
      )
      await account.destroy()
      res.status(204).end()
    }
  })
)

module.exports = router
